// ============================================================================
// ██████╗ ██████╗  █████╗ ██╗███╗   ██╗    ██████╗ 
// ██╔══██╗██╔══██╗██╔══██╗██║████╗  ██║    ╚════██╗
// ██████╔╝██████╔╝███████║██║██╔██╗ ██║     █████╔╝
// ██╔══██╗██╔══██╗██╔══██║██║██║╚██╗██║    ██╔═══╝ 
// ██████╔╝██║  ██║██║  ██║██║██║ ╚████║    ███████╗
// ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝    ╚══════╝
// 
// AI BRAIN 3-TIER LLM SERVICE - SCENARIO ENGINE
// ============================================================================
// 
// POSITION IN ARCHITECTURE:
//   Brain-1 (FrontlineIntelEngine) → Triage → [BRAIN-2] → Response
// 
// CALLED BY: Brain-1 when decision.action === 'ROUTE_TO_SCENARIO'
// NEVER CALLED DIRECTLY: Always flows through Brain-1 first
// 
// 📋 DESCRIPTION: Clean interface to AI Brain with 3-Tier Intelligence System
// 🎯 PURPOSE: Match caller input to scenarios and return factual responses
// 🔧 TIERS: 
//     - Tier 1: Rule-Based matching (FREE - 80% of calls)
//     - Tier 2: Semantic matching (FREE - 14% of calls)
//     - Tier 3: LLM Fallback (GPT-4o-mini - 6% of calls, $0.04 each)
// 
// ⚠️  CRITICAL ARCHITECTURE:
//     - Brain-2 does NOT decide actions (Brain-1 does)
//     - Brain-2 ONLY provides knowledge/scenario responses
//     - Brain-2 returns factual content; Brain-1 decides how to deliver it
//     - Redis caching for sub-50ms performance
// 
// ============================================================================

const Company = require('../models/v2Company');
const { redisClient } = require('../clients');
const logger = require('../utils/logger');
const { replacePlaceholders } = require('../utils/placeholderReplacer');
const ResponseEngine = require('./ResponseEngine');

// ═══════════════════════════════════════════════════════════════════════════
// 📼 BLACK BOX RECORDER - Enterprise Call Flight Recorder
// ═══════════════════════════════════════════════════════════════════════════
let BlackBoxLogger;
try {
    BlackBoxLogger = require('./BlackBoxLogger');
} catch (err) {
    BlackBoxLogger = null;
}

class AIBrain3tierllm {
    constructor() {
        this.performanceMetrics = {
            totalQueries: 0,
            tier1Hits: 0,
            tier2Hits: 0,
            tier3Hits: 0,
            avgResponseTime: 0,
            cacheHits: 0,
            lastOptimized: new Date()
        };
    }

    /**
     * 🎯 QUERY AI BRAIN - THE ONLY INTELLIGENCE SOURCE
     * 📋 Routes through 3-Tier Intelligence System based on production settings
     * ⚠️  CRITICAL: This is the single entry point for ALL AI responses
     * 
     * @param {string} companyId - Company identifier
     * @param {string} query - User's question/input
     * @param {Object} context - Call context (callState, routingId, etc.)
     * @returns {Object} { confidence, response, metadata }
     */
    async query(companyId, query, context = {}) {
        const startTime = Date.now();
        const routingId = context.routingId || `ai-brain-${Date.now()}`;
        const perfCheckpoints = {};
        
        try {
            logger.info(`🧠 [AI BRAIN] Processing query for company ${companyId}`, {
                routingId,
                query: query.substring(0, 100),
                callSource: context.callSource || 'production',
                isTest: context.isTest || false
            });

            // Try cache first
            const cacheStartTime = Date.now();
            const cacheKey = this.generateCacheKey(companyId, query);
            const cachedResult = await this.getCachedResult(cacheKey);
            perfCheckpoints.cacheCheck = Date.now() - cacheStartTime;
            
            if (cachedResult) {
                this.performanceMetrics.cacheHits++;
                const responseTime = Date.now() - startTime;
                logger.info(`⚡ [AI BRAIN] Cache hit (${responseTime}ms)`, { routingId });
                
                return {
                    ...cachedResult,
                    metadata: {
                        ...cachedResult.metadata,
                        cached: true,
                        responseTime
                    }
                };
            }

            // Query the AI Brain (3-Tier Intelligence)
            const aiStartTime = Date.now();
            const result = await this.queryAIBrain(companyId, query, context);
            perfCheckpoints.aiBrainQuery = Date.now() - aiStartTime;

            // Cache successful results
            if (result.confidence > 0.5 && result.response) {
                const cacheWriteStart = Date.now();
                await this.cacheResult(cacheKey, result);
                perfCheckpoints.cacheWrite = Date.now() - cacheWriteStart;
            }

            // Update metrics
            const responseTime = Date.now() - startTime;
            this.performanceMetrics.totalQueries++;
            this.performanceMetrics.avgResponseTime = 
                (this.performanceMetrics.avgResponseTime * (this.performanceMetrics.totalQueries - 1) + responseTime) / 
                this.performanceMetrics.totalQueries;

            // Track tier usage
            const tierUsed = result.metadata?.trace?.tierUsed;
            if (tierUsed === 1) this.performanceMetrics.tier1Hits++;
            if (tierUsed === 2) this.performanceMetrics.tier2Hits++;
            if (tierUsed === 3) this.performanceMetrics.tier3Hits++;
            
            // 📼 BLACK BOX: Log 3-Tier decision
            const callId = context.callId || context.callState?.callId;
            if (BlackBoxLogger && callId) {
                // Log SYNONYM_TRANSLATION if any translations occurred
                const synonymInfo = result.metadata?.trace?.synonymTranslation;
                if (synonymInfo && synonymInfo.replacements && synonymInfo.replacements.length > 0) {
                    BlackBoxLogger.logEvent({
                        callId,
                        companyId,
                        type: 'SYNONYM_TRANSLATION',
                        data: {
                            original: synonymInfo.original?.substring(0, 100),
                            translated: synonymInfo.translated?.substring(0, 100),
                            replacements: synonymInfo.replacements.map(r => `"${r.from}" → "${r.to}"`),
                            count: synonymInfo.replacements.length
                        }
                    }).catch(() => {});
                }
                
                // Log TIER3_ENTERED when entering 3-Tier system
                BlackBoxLogger.logEvent({
                    callId,
                    companyId,
                    type: 'TIER3_ENTERED',
                    data: {
                        reason: 'BRAIN2_QUERY',
                        queryPreview: query.substring(0, 50)
                    }
                }).catch(() => {});
                
                // Log which tier was used
                if (tierUsed === 1) {
                    BlackBoxLogger.logEvent({
                        callId,
                        companyId,
                        type: 'TIER3_FAST_MATCH',
                        data: {
                            source: 'RULES',
                            confidence: result.confidence,
                            scenarioName: result.metadata?.scenarioName || null,
                            ms: perfCheckpoints.aiBrainQuery || 0
                        }
                    }).catch(() => {});
                } else if (tierUsed === 2) {
                    BlackBoxLogger.logEvent({
                        callId,
                        companyId,
                        type: 'TIER3_EMBEDDING_MATCH',
                        data: {
                            confidence: result.confidence,
                            scenarioName: result.metadata?.scenarioName || null,
                            ms: perfCheckpoints.aiBrainQuery || 0
                        }
                    }).catch(() => {});
                } else if (tierUsed === 3) {
                    const cost = result.metadata?.trace?.cost?.total || 0;
                    BlackBoxLogger.logEvent({
                        callId,
                        companyId,
                        type: 'TIER3_LLM_FALLBACK_CALLED',
                        data: {
                            model: result.metadata?.model || 'unknown',
                            confidence: result.confidence,
                            ms: perfCheckpoints.aiBrainQuery || 0,
                            costUsd: cost
                        }
                    }).catch(() => {});
                    
                    BlackBoxLogger.logEvent({
                        callId,
                        companyId,
                        type: 'TIER3_LLM_FALLBACK_RESPONSE',
                        data: {
                            responsePreview: (result.response || '').substring(0, 100),
                            scenarioName: result.metadata?.scenarioName || null
                        }
                    }).catch(() => {});
                }
                
                // Log exit
                BlackBoxLogger.logEvent({
                    callId,
                    companyId,
                    type: 'TIER3_EXIT',
                    data: {
                        outcome: result.response ? 'ANSWERED' : 'NO_ANSWER',
                        tierUsed,
                        confidence: result.confidence
                    }
                }).catch(() => {});
            }

            // 🎯 PERFORMANCE SUMMARY - Crystal clear visibility
            const tierEmoji = tierUsed === 1 ? '⚡' : tierUsed === 2 ? '🧠' : tierUsed === 3 ? '🤖' : '❓';
            const tierName = tierUsed === 1 ? 'TIER 1 (Rule-Based)' : tierUsed === 2 ? 'TIER 2 (Semantic)' : tierUsed === 3 ? 'TIER 3 (LLM)' : 'UNKNOWN';
            const cost = result.metadata?.trace?.cost?.total || 0;
            const costDisplay = cost > 0 ? `$${cost.toFixed(4)}` : '$0.00 (FREE)';

            console.log('\n' + '═'.repeat(80));
            console.log(`${tierEmoji} AI BRAIN PERFORMANCE SUMMARY`);
            console.log('═'.repeat(80));
            console.log(`📞 Query: "${query.substring(0, 60)}${query.length > 60 ? '...' : ''}"`);
            console.log(`🎯 Tier Used: ${tierName}`);
            console.log(`💰 Cost: ${costDisplay}`);
            console.log(`⏱️  Total Time: ${responseTime}ms`);
            console.log(`   ├─ Cache Check: ${perfCheckpoints.cacheCheck}ms`);
            console.log(`   ├─ AI Brain Query: ${perfCheckpoints.aiBrainQuery}ms`);
            if (perfCheckpoints.cacheWrite) {
                console.log(`   └─ Cache Write: ${perfCheckpoints.cacheWrite}ms`);
            }
            console.log(`📊 Confidence: ${(result.confidence * 100).toFixed(1)}%`);
            if (result.metadata?.scenarioName) {
                console.log(`🎬 Scenario: ${result.metadata.scenarioName}`);
            }
            console.log('═'.repeat(80) + '\n');

            logger.info(`✅ [AI BRAIN] Query complete (${responseTime}ms)`, {
                routingId,
                confidence: result.confidence,
                tierUsed,
                tierName,
                cost,
                perfCheckpoints
            });

            return {
                ...result,
                metadata: {
                    ...result.metadata,
                    responseTime
                }
            };

        } catch (error) {
            logger.error(`❌ [AI BRAIN] Query failed`, {
                routingId,
                companyId,
                error: error.message,
                stack: error.stack
            });

            // 🔥 NO FALLBACK TEXT! If AI Brain fails, return null to trigger transfer
            return {
                confidence: 0,
                response: null,  // ❌ NO GENERIC TEXT! Force transfer to human
                metadata: {
                    source: 'ai-brain-critical-failure',
                    error: error.message,
                    responseTime: Date.now() - startTime,
                    action: 'transfer'  // System should transfer to human
                }
            };
        }
    }

    /**
     * 🧠 QUERY AI BRAIN - 3-TIER INTELLIGENCE SYSTEM
     * This is where all the magic happens!
     */
    async queryAIBrain(companyId, query, context) {
        try {
            const HybridScenarioSelector = require('./HybridScenarioSelector');
            const ScenarioPoolService = require('./ScenarioPoolService');
            const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
            const IntelligentRouter = require('./IntelligentRouter');
            const AdminSettings = require('../models/AdminSettings');
            
            logger.info(`⚡ [AI BRAIN] Loading scenarios and intelligence config`, {
                routingId: context.routingId
            });

            // Load company configuration
            const company = await Company.findById(companyId)
                .select('configuration aiAgentSettings aiAgentSettings')
                .lean();

            if (!company) {
                return {
                    confidence: 0,
                    response: null,
                    metadata: {
                        source: 'ai-brain',
                        error: 'Company not found'
                    }
                };
            }

            // Determine intelligence settings (Global vs Custom)
            const useGlobalIntelligence = company?.aiAgentSettings?.useGlobalIntelligence !== false;
            let intelligenceEnabled = false;
            let intelligenceConfig = null;
            
            if (useGlobalIntelligence) {
                const adminSettings = await AdminSettings.findOne({});
                const globalIntelligence = adminSettings?.globalProductionIntelligence || {};
                intelligenceEnabled = globalIntelligence.enabled === true;
                intelligenceConfig = globalIntelligence;
                
                logger.info(`🌐 [AI BRAIN] Using GLOBAL intelligence settings`, {
                    routingId: context.routingId,
                    enabled: intelligenceEnabled,
                    tier1: globalIntelligence.thresholds?.tier1 || 0.80,
                    tier2: globalIntelligence.thresholds?.tier2 || 0.60,
                    tier3Enabled: globalIntelligence.thresholds?.enableTier3
                });
            } else {
                const productionIntelligence = company?.aiAgentSettings?.productionIntelligence || {};
                intelligenceEnabled = productionIntelligence.enabled === true;
                intelligenceConfig = productionIntelligence;
                
                logger.info(`🎯 [AI BRAIN] Using CUSTOM intelligence settings`, {
                    routingId: context.routingId,
                    enabled: intelligenceEnabled,
                    tier1: productionIntelligence.thresholds?.tier1 || 0.80,
                    tier2: productionIntelligence.thresholds?.tier2 || 0.60,
                    tier3Enabled: productionIntelligence.thresholds?.enableTier3
                });
            }

            // Load scenarios from AI Brain (Scenario Pool)
            const { scenarios, templatesUsed } = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
            
            if (!templatesUsed || templatesUsed.length === 0) {
                logger.info(`ℹ️ [AI BRAIN] No templates configured for company`, {
                    routingId: context.routingId
                });
                return {
                    confidence: 0,
                    response: null,
                    metadata: {
                        source: 'ai-brain',
                        reason: 'No AI Brain templates assigned to company'
                    }
                };
            }

            // Filter to only enabled scenarios
            const enabledScenarios = scenarios.filter(s => s.isEnabledForCompany !== false);
            
            if (enabledScenarios.length === 0) {
                return {
                    confidence: 0,
                    response: null,
                    metadata: {
                        source: 'ai-brain',
                        reason: 'No enabled scenarios (all disabled)'
                    }
                };
            }

            logger.info(`🧠 [AI BRAIN] Loaded ${enabledScenarios.length} enabled scenarios from ${templatesUsed.length} template(s)`);

            // Route through appropriate intelligence tier
            let result;
            
            if (intelligenceEnabled) {
                // ============================================
                // 🚀 3-TIER INTELLIGENCE (PRODUCTION MODE)
                // ============================================
                logger.info(`🚀 [AI BRAIN] Using 3-Tier Intelligence (Tier 1 → 2 → 3)`, {
                    routingId: context.routingId,
                    mode: useGlobalIntelligence ? 'GLOBAL' : 'CUSTOM'
                });
                
                const primaryTemplate = await GlobalInstantResponseTemplate.findById(templatesUsed[0].templateId);
                
                if (!primaryTemplate) {
                    return {
                        confidence: 0,
                        response: null,
                        metadata: {
                            source: 'ai-brain',
                            error: 'Primary template not found'
                        }
                    };
                }
                
                const router = IntelligentRouter;
                
                const routingResult = await router.route({
                    callerInput: query,
                    template: primaryTemplate,
                    company: company,
                    callId: context.callState?.callId || context.routingId,
                    context: {
                        callSource: context.callSource || 'production',
                        isTest: context.isTest || false,
                        callState: context.callState,
                        intelligenceConfig,
                        routingId: context.routingId
                    }
                });
                
                logger.info(`✅ [AI BRAIN] 3-Tier routing complete`, {
                    routingId: context.routingId,
                    matched: routingResult.matched,
                    tierUsed: routingResult.tierUsed,
                    confidence: routingResult.confidence,
                    cost: routingResult.cost?.total || 0
                });
                
                if (routingResult.matched && routingResult.scenario) {
                    result = {
                        scenario: routingResult.scenario,
                        confidence: routingResult.confidence,
                        score: routingResult.confidence,
                        response: routingResult.response,  // ✅ CRITICAL FIX: Include response from router
                        trace: {
                            tierUsed: routingResult.tierUsed,
                            tier1Score: routingResult.tier1Result?.confidence || 0,
                            tier2Score: routingResult.tier2Result?.confidence || 0,
                            tier3Score: routingResult.tier3Result?.confidence || 0,
                            timingMs: routingResult.performance || {},
                            cost: routingResult.cost || {}
                        }
                    };
                } else {
                    result = {
                        scenario: null,
                        confidence: 0,
                        score: 0,
                        trace: { tierUsed: routingResult.tierUsed, reason: 'No match above thresholds' }
                    };
                }
                
            } else {
                // ============================================
                // 🎯 TIER 1 ONLY (LEGACY/TESTING MODE)
                // ============================================
                logger.info(`🎯 [AI BRAIN] Using Tier 1 only (3-Tier disabled)`, {
                    routingId: context.routingId
                });
                
                const allFillers = [
                    ...(company.configuration?.fillerWords?.inherited || []),
                    ...(company.configuration?.fillerWords?.custom || []),
                    ...(company.aiAgentSettings?.fillerWords?.custom || [])
                ];
                const effectiveFillers = [...new Set(allFillers)];
                
                const urgencyKeywords = [
                    ...(company.configuration?.urgencyKeywords?.inherited || []),
                    ...(company.configuration?.urgencyKeywords?.custom || [])
                ];
                
                const selector = new HybridScenarioSelector(effectiveFillers, urgencyKeywords, null);

                const matchContext = {
                    channel: context.channel || 'voice',
                    language: context.language || 'auto',
                    conversationState: context.callState || {}
                };

                result = await selector.selectScenario(query, enabledScenarios, matchContext);
            }
            
            // Process result and return response
            if (result.scenario && result.confidence > 0) {
                logger.info(`✅ [AI BRAIN] Scenario matched!`, {
                    routingId: context.routingId,
                    scenarioId: result.scenario.scenarioId,
                    name: result.scenario.name,
                    confidence: result.confidence.toFixed(3)
                });

                // ✅ CRITICAL FIX: Use response from router if available, otherwise extract from scenario
                let selectedReply;
                let replyType = 'full'; // Default reply type
                
                if (result.response) {
                    // Router already selected the response (Tier 1/2/3)
                    selectedReply = result.response;
                    // Infer reply type from response length (just for metadata)
                    replyType = result.response.length < 100 ? 'quick' : 'full';
                } else {
                    // 🎯 PHASE 2: RESPONSE ENGINE - CENTRALIZED REPLY SELECTION
                    // Delegate ALL reply selection to Response Engine based on:
                    // - scenarioType (INFO_FAQ, ACTION_FLOW, SYSTEM_ACK, SMALL_TALK)
                    // - replyStrategy (AUTO, FULL_ONLY, QUICK_ONLY, QUICK_THEN_FULL, LLM_WRAP, LLM_CONTEXT)
                    // - channel (voice, sms, chat)
                    
                    const channel = context && context.channel ? context.channel : 'voice';
                    
                    try {
                        const responseEngineResult = await ResponseEngine.buildResponse({
                            scenario: result.scenario,
                            channel,
                            context
                        });
                        
                        selectedReply = responseEngineResult.text;
                        replyType = responseEngineResult.strategyUsed.includes('QUICK') ? 'quick' : 'full';
                        
                        // Add Response Engine metadata for tracing
                        result.scenarioTypeResolved = responseEngineResult.scenarioTypeResolved;
                        result.replyStrategyResolved = responseEngineResult.replyStrategyResolved;
                        result.responseStrategyUsed = responseEngineResult.strategyUsed;
                        
                        // 🎯 PHASE A – STEP 3A: Store follow-up metadata for runtime use
                        result.followUp = responseEngineResult.followUp;
                        
                    } catch (error) {
                        logger.error('🚨 [AI BRAIN] Response Engine failed, no fallback', {
                            routingId: context.routingId,
                            error: error.message,
                            scenarioId: result.scenario?.scenarioId,
                            scenarioName: result.scenario?.name
                        });
                        selectedReply = null;  // ❌ NO FALLBACK TEXT!
                    }
                }
                
                // 🔥 If no reply found, return null (no processing)
                const processedResponse = selectedReply ? replacePlaceholders(selectedReply, company) : null;

                return {
                    confidence: result.confidence,
                    response: processedResponse,  // null if scenario has no replies
                    metadata: {
                        source: 'ai-brain',
                        scenarioId: result.scenario.scenarioId,
                        scenarioName: result.scenario.name,
                        replyType: replyType,
                        matchScore: result.score,
                        trace: result.trace,
                        // 🎯 PHASE 2: Response Engine metadata
                        scenarioTypeResolved: result.scenarioTypeResolved,
                        replyStrategyResolved: result.replyStrategyResolved,
                        responseStrategyUsed: result.responseStrategyUsed,
                        // 🎯 PHASE A – STEP 3A: Follow-up metadata (for Twilio runtime in Phase 3B)
                        followUp: result.followUp || {
                            mode: 'NONE',
                            questionText: null,
                            transferTarget: null
                        }
                    }
                };
            }

            logger.info(`ℹ️ [AI BRAIN] No scenario matched`, {
                routingId: context.routingId,
                bestScore: result.score || 0
            });

            return {
                confidence: 0,
                response: null,
                metadata: {
                    source: 'ai-brain',
                    reason: 'No scenario matched above threshold',
                    trace: result.trace
                }
            };

        } catch (error) {
            logger.error(`❌ [AI BRAIN] Error in queryAIBrain`, {
                routingId: context.routingId,
                error: error.message
            });

            return {
                confidence: 0,
                response: null,
                metadata: {
                    source: 'ai-brain',
                    error: error.message
                }
            };
        }
    }

    // ============================================
    // 🚀 CACHING & PERFORMANCE HELPERS
    // ============================================

    generateCacheKey(companyId, query) {
        const normalizedQuery = query.toLowerCase().trim().substring(0, 100);
        return `ai-brain:${companyId}:${Buffer.from(normalizedQuery).toString('base64').substring(0, 50)}`;
    }

    async getCachedResult(cacheKey) {
        try {
            if (redisClient && redisClient.isReady) {
                const cached = await redisClient.get(cacheKey);
                if (cached) {
                    return JSON.parse(cached);
                }
            }
        } catch (error) {
            logger.warn(`⚠️ [AI BRAIN] Cache read failed`, { error: error.message });
        }
        return null;
    }

    async cacheResult(cacheKey, result) {
        try {
            if (redisClient && redisClient.isReady) {
                await redisClient.setEx(cacheKey, 300, JSON.stringify(result)); // 5min TTL
            }
        } catch (error) {
            logger.warn(`⚠️ [AI BRAIN] Cache write failed`, { error: error.message });
        }
    }

    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            tier1Percentage: (this.performanceMetrics.tier1Hits / this.performanceMetrics.totalQueries * 100).toFixed(1),
            tier2Percentage: (this.performanceMetrics.tier2Hits / this.performanceMetrics.totalQueries * 100).toFixed(1),
            tier3Percentage: (this.performanceMetrics.tier3Hits / this.performanceMetrics.totalQueries * 100).toFixed(1),
            cacheHitRate: (this.performanceMetrics.cacheHits / this.performanceMetrics.totalQueries * 100).toFixed(1)
        };
    }
}

// Export singleton instance
module.exports = new AIBrain3tierllm();

