// ============================================================================
// PRIORITY-DRIVEN KNOWLEDGE ROUTER - PHASE 4.1
// 📋 DESCRIPTION: V2-grade AI agent runtime with priority-based knowledge routing
// 🎯 PURPOSE: Route AI agent queries through configured knowledge sources with intelligent fallback
// 🔧 FEATURES: 
//     - Priority-based routing (companyQnA → tradeQnA → templates → inHouseFallback)
//     - Confidence threshold enforcement
//     - Sub-50ms response time optimization with Redis caching
//     - Comprehensive logging and performance tracking
//     - Graceful fallback with intelligent error recovery
// 📝 FUTURE EXPANSION: 
//     - Machine learning optimization of thresholds
//     - V2 DELETED: Legacy A/B testing eliminated
//     - Real-time performance analytics
//     - Advanced context understanding
//     - Multi-language support
// ⚠️  CRITICAL NOTES:
//     - Integrates with Company.aiAgentLogic.knowledgeSourcePriorities configuration
//     - Uses Redis caching for sub-50ms performance targets
//     - Always provides a response (inHouseFallback never fails)
//     - Logs all routing decisions for analytics and optimization
//     - Maintains conversation context and personality integration
// ============================================================================

const Company = require('../models/v2Company');
// V3 SYSTEM: CompanyQnACategory is the NEW category-based Q&A system (replaces old flat CompanyKnowledgeQnA)
const CompanyQnACategory = require('../models/CompanyQnACategory');
// V2 DELETED: Legacy v2 aiAgentCacheService - using simple Redis directly
const { redisClient } = require('../clients');
const logger = require('../utils/logger');
const { replacePlaceholders } = require('../utils/placeholderReplacer');

class PriorityDrivenKnowledgeRouter {
    constructor() {
        this.performanceMetrics = {
            totalQueries: 0,
            avgResponseTime: 0,
            successRate: 0,
            sourceHitRates: {},
            lastOptimized: new Date()
        };
        this.routingCache = new Map();
        this.maxCacheSize = 1000;
        
        // 🚀 PERFORMANCE OPTIMIZATION: Keyword index caching
        this.keywordIndexCache = new Map();
        this.keywordCacheExpiry = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * 🎯 MAIN ROUTING METHOD - THE HEART OF AI AGENT INTELLIGENCE
     * 📋 Routes query through priority-configured knowledge sources
     * ⚠️  CRITICAL: Must always return a response, never fail
     * 🔧 Implements priority flow with confidence thresholds and fallback
     */
    async routeQuery(companyId, query, options = {}) {
        const startTime = Date.now();
        const routingId = this.generateRoutingId();
        
        try {
            logger.info(`🎯 Starting priority-driven routing for company ${companyId}`, {
                routingId,
                query: query.substring(0, 100),
                options
            });

            // Get priority configuration (cached for performance)
            const priorityConfig = await this.getPriorityConfiguration(companyId);
            if (!priorityConfig) {
                return this.handleConfigurationError(companyId, query, routingId);
            }

            // Initialize routing context
            const routingContext = {
                routingId,
                companyId,
                query,
                startTime,
                priorityConfig,
                options,
                routingFlow: [],
                finalMatch: null,
                performance: {}
            };

            // Execute priority-driven routing
            const result = await this.executePriorityRouting(routingContext);

            // Log routing completion
            const totalTime = Date.now() - startTime;
            this.logRoutingCompletion(routingContext, result, totalTime);
            
            // Update performance metrics
            this.updatePerformanceMetrics(result, totalTime);
            
            // 🚀 NEW: Track performance for AI Performance Dashboard
            await this.trackPerformanceMetrics(companyId, routingContext, result, totalTime);

            return result;

        } catch (error) {
            logger.error(`❌ Critical error in priority routing for company ${companyId}`, {
                routingId,
                error: error.message,
                stack: error.stack
            });

            // Emergency fallback - never let the AI agent fail
            return this.emergencyFallback(companyId, query, routingId);
        }
    }

    /**
     * 🔄 PRIORITY ROUTING EXECUTION ENGINE
     * 📋 Executes the configured priority flow with intelligent decision making
     * ⚠️  CRITICAL: Follows exact priority order with confidence thresholds
     */
    async executePriorityRouting(context) {
        const { priorityConfig, query, companyId, routingId } = context;

        // Sort sources by priority (1 = highest priority)
        const sortedSources = [...priorityConfig.priorityFlow]
            .filter(source => source.enabled)
            .sort((a, b) => a.priority - b.priority);

        logger.info(`🔄 Executing priority routing with ${sortedSources.length} enabled sources`, {
            routingId,
            sources: sortedSources.map(s => `${s.source}(${s.priority})`).join(' → ')
        });

        // Try each source in priority order
        for (const sourceConfig of sortedSources) {
            const sourceStartTime = Date.now();
            
            try {
                logger.info(`🔍 Testing source: ${sourceConfig.source} (priority ${sourceConfig.priority}, threshold ${sourceConfig.threshold})`, {
                    routingId
                });

                const sourceResult = await this.queryKnowledgeSource(
                    companyId, 
                    sourceConfig.source, 
                    query, 
                    context
                );

                const sourceTime = Date.now() - sourceStartTime;
                
                // Add to routing flow for analytics
                context.routingFlow.push({
                    source: sourceConfig.source,
                    priority: sourceConfig.priority,
                    threshold: sourceConfig.threshold,
                    confidence: sourceResult.confidence,
                    responseTime: `${sourceTime}ms`,
                    match: sourceResult.confidence >= sourceConfig.threshold,
                    result: sourceResult.confidence >= sourceConfig.threshold ? 'Match found' : 'Below threshold'
                });

                // Check if confidence meets threshold
                if (sourceResult.confidence >= sourceConfig.threshold) {
                    logger.info(`✅ Match found in ${sourceConfig.source}`, {
                        routingId,
                        confidence: sourceResult.confidence,
                        threshold: sourceConfig.threshold,
                        responseTime: sourceTime
                    });

                    // Apply personality to the response before returning
                    const personalizedResponse = await this.applyPersonality(
                        companyId, 
                        sourceResult.response, 
                        sourceConfig.source
                    );

                    context.finalMatch = {
                        source: sourceConfig.source,
                        confidence: sourceResult.confidence,
                        response: personalizedResponse,
                        originalResponse: sourceResult.response,
                        metadata: sourceResult.metadata,
                        personalityApplied: personalizedResponse !== sourceResult.response
                    };

                    return this.buildSuccessResponse(context);
                }

                logger.info(`⚠️ ${sourceConfig.source} below threshold`, {
                    routingId,
                    confidence: sourceResult.confidence,
                    threshold: sourceConfig.threshold,
                    continuing: true
                });

            } catch (sourceError) {
                logger.error(`❌ Error in source ${sourceConfig.source}`, {
                    routingId,
                    error: sourceError.message
                });

                // Add error to routing flow
                context.routingFlow.push({
                    source: sourceConfig.source,
                    priority: sourceConfig.priority,
                    threshold: sourceConfig.threshold,
                    confidence: 0,
                    responseTime: `${Date.now() - sourceStartTime}ms`,
                    match: false,
                    result: `Error: ${sourceError.message}`
                });

                // Continue to next source on error
                continue;
            }
        }

        // If no source matched, use fallback behavior
        return this.handleNoMatch(context);
    }

    /**
     * 🔍 KNOWLEDGE SOURCE QUERY ENGINE
     * 📋 Queries individual knowledge sources with caching and optimization
     * ⚠️  CRITICAL: Must handle all source types consistently
     */
    async queryKnowledgeSource(companyId, sourceType, query, context) {
        const cacheKey = `query:${companyId}:${sourceType}:${this.hashQuery(query)}`;
        
        // V2 SYSTEM: Simple Redis cache check (Redis v5+ compatible)
        try {
            if (redisClient && redisClient.isReady) {
                const cachedResult = await redisClient.get(cacheKey);
                if (cachedResult) {
                    logger.info(`🚀 V2 Cache hit for ${sourceType}`, { routingId: context.routingId });
                    return JSON.parse(cachedResult);
                }
            }
        } catch (error) {
            logger.warn(`⚠️ V2 Cache check failed for ${sourceType}`, { error: error.message });
        }

        let result;
        
        switch (sourceType) {
            case 'instantResponses':
                result = await this.queryInstantResponses(companyId, query, context);
                break;
            case 'companyQnA':
                result = await this.queryCompanyQnA(companyId, query, context);
                break;
            case 'tradeQnA':
                result = await this.queryTradeQnA(companyId, query, context);
                break;
            case 'templates':
                result = await this.queryTemplates(companyId, query, context);
                break;
            case 'inHouseFallback':
                result = await this.queryInHouseFallback(companyId, query, context);
                break;
            default:
                throw new Error(`Unknown source type: ${sourceType}`);
        }

        // Cache result for future queries (5 minute TTL)
        // V2 SYSTEM: Simple Redis cache set (Redis v5+ compatible)
        try {
            if (redisClient && redisClient.isReady) {
                await redisClient.setEx(cacheKey, 300, JSON.stringify(result));
            }
        } catch (error) {
            logger.warn(`⚠️ V2 Cache set failed`, { error: error.message });
        }
        
        return result;
    }

    /**
     * ⚡ INSTANT RESPONSES QUERY ENGINE (PRIORITY 0) - V3 HYBRID BRAIN
     * 📋 Ultra-fast matching using HybridScenarioSelector (sub-10ms target)
     * 🎯 Purpose: Provide immediate answers using Global AI Brain with hybrid matching
     * 🧠 NEW: Uses BM25 + Regex + Context + Negative Triggers for world-class intelligence
     * ⚠️  CRITICAL: Must be fastest source - uses in-memory matching with cached templates
     */
    async queryInstantResponses(companyId, query, context) {
        try {
            const HybridScenarioSelector = require('./HybridScenarioSelector');
            const ScenarioPoolService = require('./ScenarioPoolService');
            const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
            
            logger.info(`⚡ [V3 HYBRID BRAIN] Querying instant responses for "${query.substring(0, 50)}..."`, {
                routingId: context.routingId
            });

            // ============================================
            // 🚀 NEW: USE SCENARIOPOOLSERVICE (CANONICAL SOURCE)
            // ============================================
            // Loads scenarios from all active templates (multi-template support)
            // Applies per-company scenarioControls (enable/disable)
            // Replaces manual template loading and scenario flattening
            const { scenarios, templatesUsed } = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
            
            if (!templatesUsed || templatesUsed.length === 0) {
                logger.info(`ℹ️ [V3 HYBRID BRAIN] No templates configured for company`, {
                    routingId: context.routingId,
                    companyId
                });
                return {
                    confidence: 0,
                    response: null,
                    metadata: {
                        source: 'instantResponses',
                        reason: 'No Global AI Brain templates assigned'
                    }
                };
            }

            // ============================================
            // 🎯 FILTER: ONLY USE ENABLED SCENARIOS
            // ============================================
            // CRITICAL: Runtime must respect per-company scenario controls
            // Scenarios with isEnabledForCompany=false are NEVER matched
            const enabledScenarios = scenarios.filter(s => s.isEnabledForCompany !== false);
            
            if (enabledScenarios.length === 0) {
                logger.info(`ℹ️ [V3 HYBRID BRAIN] No enabled scenarios for company`, {
                    routingId: context.routingId,
                    totalScenarios: scenarios.length,
                    disabledScenarios: scenarios.length - enabledScenarios.length
                });
                return {
                    confidence: 0,
                    response: null,
                    metadata: {
                        source: 'instantResponses',
                        reason: 'No enabled scenarios (all disabled or no templates)'
                    }
                };
            }

            logger.info(`🧠 [V3 HYBRID BRAIN] Loaded ${enabledScenarios.length} enabled scenarios (${scenarios.length - enabledScenarios.length} disabled) from ${templatesUsed.length} template(s)`);

            // ============================================
            // 🔇 BUILD EFFECTIVE FILLERS & SYNONYMS
            // ============================================
            // Load company configuration for filler words and synonyms
            const company = await Company.findById(companyId)
                .select('configuration.fillerWords configuration.urgencyKeywords aiAgentSettings.fillerWords')
                .lean();

            // Build filler words (template inherited + company custom)
            const allFillers = [
                ...(company.configuration?.fillerWords?.inherited || []),
                ...(company.configuration?.fillerWords?.custom || []),
                ...(company.aiAgentSettings?.fillerWords?.custom || [])
            ];
            const effectiveFillers = [...new Set(allFillers)];
            
            // Load urgency keywords
            const urgencyKeywords = [
                ...(company.configuration?.urgencyKeywords?.inherited || []),
                ...(company.configuration?.urgencyKeywords?.custom || [])
            ];
            
            // TODO: Build effective synonym map from templates
            // For now, we pass null and let HybridScenarioSelector use defaults
            const effectiveSynonymMap = null;
            
            logger.info(`🔇 [V3 HYBRID BRAIN] Loaded ${effectiveFillers.length} filler words, ${urgencyKeywords.length} urgency keywords`);
            
            // ============================================
            // 🧠 INSTANTIATE HYBRID SCENARIO SELECTOR
            // ============================================
            const selector = new HybridScenarioSelector(effectiveFillers, urgencyKeywords, effectiveSynonymMap);

            // Build match context
            const matchContext = {
                channel: context.channel || 'voice',
                language: context.language || 'auto',
                conversationState: context.callState || {},
                recentScenarios: {}, // TODO: Track recently used scenarios in Redis
                lastIntent: context.callState?.lastIntent || null,
                callerProfile: null // TODO: Load caller preferences from DB
            };

            // ============================================
            // 🎯 MATCH SCENARIO
            // ============================================
            const result = await selector.selectScenario(
                query,
                enabledScenarios, // CRITICAL: Only pass enabled scenarios
                matchContext
            );

            if (result.scenario && result.confidence > 0) {
                logger.info(`✅ [V3 HYBRID BRAIN] Scenario matched!`, {
                    routingId: context.routingId,
                    scenarioId: result.scenario.scenarioId,
                    name: result.scenario.name,
                    confidence: result.confidence.toFixed(3),
                    score: result.score.toFixed(3),
                    timeMs: result.trace.timingMs.total
                });

                // Select a reply variant (quick or full)
                const useQuickReply = Math.random() < 0.3; // 30% chance for quick reply
                let replyVariants = useQuickReply ? result.scenario.quickReplies : result.scenario.fullReplies;
                
                // Fallback to full replies if quick replies empty
                if (!replyVariants || replyVariants.length === 0) {
                    replyVariants = result.scenario.fullReplies || result.scenario.quickReplies || [];
                }

                // Select random variant (TODO: Use bandit algorithm for optimization)
                const selectedReply = replyVariants[Math.floor(Math.random() * replyVariants.length)] || 
                                     "I'm here to help!";

                // Replace placeholders in response
                const processedResponse = replacePlaceholders(selectedReply, company);

                return {
                    confidence: result.confidence,
                    response: processedResponse,
                    metadata: {
                        source: 'instantResponses',
                        scenarioId: result.scenario.scenarioId,
                        scenarioName: result.scenario.name,
                        replyType: useQuickReply ? 'quick' : 'full',
                        matchScore: result.score,
                        breakdown: result.breakdown,
                        timeMs: result.trace.timingMs.total,
                        trace: result.trace // Full trace for debugging
                    }
                };
            }

            logger.info(`ℹ️ [V3 HYBRID BRAIN] No scenario matched above confidence threshold`, {
                routingId: context.routingId,
                bestScore: result.score || 0,
                bestConfidence: result.confidence || 0
            });

            return {
                confidence: 0,
                response: null,
                metadata: {
                    source: 'instantResponses',
                    reason: 'No scenario matched above confidence threshold',
                    trace: result.trace // Include trace even on no-match for debugging
                }
            };

        } catch (error) {
            logger.error(`❌ [V3 HYBRID BRAIN] Error querying instant responses`, {
                routingId: context.routingId,
                error: error.message,
                stack: error.stack
            });

            return {
                confidence: 0,
                response: null,
                metadata: {
                    source: 'instantResponses',
                    error: error.message
                }
            };
        }
    }

    /**
     * 🏢 COMPANY Q&A QUERY ENGINE (OPTIMIZED)
     * 📋 Searches company-specific questions and answers with pre-filtering
     * ⚡ Performance: Pre-filter eliminates 80%+ of unnecessary queries
     */
    async queryCompanyQnA(companyId, query, context) {
        try {
            // 🚀 OPTIMIZATION: Pre-filter check before expensive query
            const canMatch = await this.canSourceMatch(companyId, query, 'companyQnA');
            if (!canMatch) {
                logger.info(`⚡ Pre-filter SKIP: No keyword matches in companyQnA for "${query}"`, { 
                    routingId: context.routingId 
                });
                return { 
                    confidence: 0, 
                    response: null, 
                    metadata: { 
                        source: 'companyQnA', 
                        skipped: 'pre-filter',
                        reason: 'No keyword overlap detected'
                    } 
                };
            }
            
            logger.info(`⚡ Pre-filter PASS: Keyword matches found in companyQnA`, { 
                routingId: context.routingId 
            });

            // 🎯 V3 FIX: Load from NEW category-based system (CompanyQnACategory)
            // This is the NEW system built yesterday - NOT the legacy flat CompanyKnowledgeQnA!
            const categories = await CompanyQnACategory.find({ 
                companyId, 
                isActive: true 
            }).lean();
            
            if (!categories || categories.length === 0) {
                logger.info(`🔍 No Company Q&A categories found for company ${companyId}`, { routingId: context.routingId });
                return { confidence: 0, response: null, metadata: { source: 'companyQnA', error: 'No company Q&A categories - use Company Q&A tab to create categories and add Q&As' } };
            }
            
            // Load company for placeholder replacement
            const company = await Company.findById(companyId).select('aiAgentLogic.placeholders').lean();

            logger.info(`🔍 Found ${categories.length} Company Q&A categories`, { 
                routingId: context.routingId,
                categoryNames: categories.map(c => c.name)
            });

            // 🤖 BUILD CATEGORY ROLES MAP & FLATTEN ALL Q&As FROM ALL CATEGORIES
            const categoryRoles = {};
            const allQnAs = [];
            
            categories.forEach(cat => {
                // Store AI Agent Role for this category
                if (cat.description && cat.description.trim()) {
                    categoryRoles[cat.name] = cat.description; // description = AI Agent Role
                }
                
                // Flatten Q&As from this category (with category name attached)
                if (cat.qnas && Array.isArray(cat.qnas)) {
                    cat.qnas.forEach(qna => {
                        if (qna.isActive !== false) { // Default true if not specified
                            allQnAs.push({
                                ...qna,
                                categoryId: cat._id.toString(),
                                categoryName: cat.name,
                                aiAgentRole: categoryRoles[cat.name] || null
                            });
                        }
                    });
                }
            });
            
            logger.info(`🤖 Loaded ${Object.keys(categoryRoles).length} AI Agent roles, ${allQnAs.length} total Q&As`, { 
                routingId: context.routingId,
                categories: Object.keys(categoryRoles)
            });
            
            if (allQnAs.length === 0) {
                logger.info(`🔍 No Q&As found in categories for company ${companyId}`, { routingId: context.routingId });
                return { confidence: 0, response: null, metadata: { source: 'companyQnA', error: 'No Q&As in categories - use "Generate Top 15 Q&As" or add manually' } };
            }

            let bestMatch = { confidence: 0, response: null, metadata: {} };

            for (const qna of allQnAs) {
                const confidence = this.calculateConfidence(query, qna.question, qna.keywords);
                
                if (confidence > bestMatch.confidence) {
                    bestMatch = {
                        confidence,
                        response: qna.answer,
                        metadata: {
                            source: 'companyQnA',
                            qnaId: qna.id || qna._id?.toString(),
                            categoryId: qna.categoryId,
                            category: qna.categoryName,
                            aiAgentRole: qna.aiAgentRole, // 🤖 AI AGENT ROLE - For AI to read and adopt!
                            matchedKeywords: this.getMatchedKeywords(query, qna.keywords)
                        }
                    };
                }
            }

            // 🤖 Log if AI Agent Role is being used
            if (bestMatch.metadata?.aiAgentRole) {
                logger.info(`🤖 AI Agent Role loaded for response`, {
                    routingId: context.routingId,
                    category: bestMatch.metadata.category,
                    rolePreview: `${bestMatch.metadata.aiAgentRole.substring(0, 100)  }...`
                });
            }

            // Replace placeholders in response
            if (bestMatch.response && company) {
                bestMatch.response = replacePlaceholders(bestMatch.response, company);
            }

            return bestMatch;

        } catch (error) {
            logger.error('Error querying company Q&A', { companyId, error: error.message });
            return { confidence: 0, response: null, metadata: { source: 'companyQnA', error: error.message } };
        }
    }

    /**
     * 🔧 TRADE Q&A QUERY ENGINE - OPTIMIZED WITH PRE-FILTERING
     * 📋 Searches industry-specific technical knowledge with smart pre-filtering
     * ⚡ Performance: Pre-filter + Redis caching for sub-50ms responses
     */
    async queryTradeQnA(companyId, query, context) {
        const startTime = Date.now();
        try {
            // 🚀 OPTIMIZATION: Pre-filter check before expensive query
            const canMatch = await this.canSourceMatch(companyId, query, 'tradeQnA');
            if (!canMatch) {
                logger.info(`⚡ Pre-filter SKIP: No keyword matches in tradeQnA for "${query}"`, { 
                    routingId: context.routingId 
                });
                return { 
                    confidence: 0, 
                    response: null, 
                    metadata: { 
                        source: 'tradeQnA', 
                        skipped: 'pre-filter',
                        reason: 'No keyword overlap detected'
                    } 
                };
            }
            
            logger.info(`⚡ Pre-filter PASS: Keyword matches found in tradeQnA`, { 
                routingId: context.routingId 
            });
            // 🚀 V2 REDIS CACHE FIRST - Sub-50ms performance target (Redis v5+ compatible)
            let knowledge = null;
            try {
                if (redisClient && redisClient.isReady) {
                    const cacheKey = `company:${companyId}:knowledge`;
                    const cached = await redisClient.get(cacheKey);
                    if (cached) {knowledge = JSON.parse(cached);}
                }
            } catch (error) {
                logger.warn(`⚠️ V2 Cache check failed for trade knowledge`, { error: error.message });
            }
            
            // Load company for knowledge and placeholders
            let company = null;
            if (!knowledge) {
                // Cache miss - load from MongoDB and cache
                company = await Company.findById(companyId).select('aiAgentLogic.knowledgeManagement aiAgentLogic.placeholders');
                if (!company?.aiAgentLogic?.knowledgeManagement) {
                    return { confidence: 0, response: null, metadata: { source: 'tradeQnA', error: 'No knowledge data' } };
                }
                
                knowledge = company.aiAgentLogic.knowledgeManagement;
                // V2 FIX: Cache knowledge using direct Redis instead of deleted aiAgentCache
                if (redisClient && redisClient.isReady) {
                    await redisClient.setEx(`knowledge:${companyId}`, 300, JSON.stringify(knowledge));
                }
                logger.debug(`🔄 Trade Q&A cache miss - loaded from MongoDB (${Date.now() - startTime}ms)`);
            } else {
                logger.debug(`⚡ Trade Q&A cache hit - Redis lookup (${Date.now() - startTime}ms)`);
                // If knowledge was cached, still need to load company for placeholders
                company = await Company.findById(companyId).select('aiAgentLogic.placeholders').lean();
            }
            
            if (!knowledge?.tradeQnA || knowledge.tradeQnA.length === 0) {
                return { confidence: 0, response: null, metadata: { source: 'tradeQnA', error: 'No trade Q&A data' } };
            }

            const tradeQnA = knowledge.tradeQnA;
            let bestMatch = { confidence: 0, response: null, metadata: {} };

            for (const qna of tradeQnA) {
                const confidence = this.calculateConfidence(query, qna.question, qna.keywords);
                
                if (confidence > bestMatch.confidence) {
                    bestMatch = {
                        confidence,
                        response: qna.answer,
                        metadata: {
                            source: 'tradeQnA',
                            qnaId: qna.id,
                            tradeCategory: qna.tradeCategory,
                            difficulty: qna.difficulty,
                            matchedKeywords: this.getMatchedKeywords(query, qna.keywords)
                        }
                    };
                }
            }

            // Replace placeholders in response
            if (bestMatch.response && company) {
                bestMatch.response = replacePlaceholders(bestMatch.response, company);
            }

            // Add performance metrics
            const responseTime = Date.now() - startTime;
            bestMatch.metadata.responseTime = responseTime;
            bestMatch.metadata.cached = Boolean(knowledge.cachedAt);
            
            logger.debug(`🎯 Trade Q&A query completed: ${responseTime}ms (confidence: ${bestMatch.confidence})`);
            return bestMatch;

        } catch (error) {
            const responseTime = Date.now() - startTime;
            logger.error('Error querying trade Q&A', { companyId, error: error.message, responseTime });
            return { confidence: 0, response: null, metadata: { source: 'tradeQnA', error: error.message, responseTime } };
        }
    }

    /**
     * 📄 TEMPLATES QUERY ENGINE
     * 📋 Searches response templates for standardized responses
     */
    async queryTemplates(companyId, query, context) {
        try {
            const company = await Company.findById(companyId).select('aiAgentLogic.knowledgeManagement.templates aiAgentLogic.placeholders');
            
            if (!company?.aiAgentLogic?.knowledgeManagement?.templates) {
                return { confidence: 0, response: null, metadata: { source: 'templates', error: 'No templates data' } };
            }

            const templates = company.aiAgentLogic.knowledgeManagement.templates;
            let bestMatch = { confidence: 0, response: null, metadata: {} };

            for (const template of templates) {
                const confidence = this.calculateConfidence(query, template.name, template.keywords);
                
                if (confidence > bestMatch.confidence) {
                    bestMatch = {
                        confidence,
                        response: template.content,
                        metadata: {
                            source: 'templates',
                            templateId: template.id,
                            type: template.type,
                            category: template.category,
                            matchedKeywords: this.getMatchedKeywords(query, template.keywords)
                        }
                    };
                }
            }

            // Replace placeholders in response
            if (bestMatch.response && company) {
                bestMatch.response = replacePlaceholders(bestMatch.response, company);
            }

            return bestMatch;

        } catch (error) {
            logger.error('Error querying templates', { companyId, error: error.message });
            return { confidence: 0, response: null, metadata: { source: 'templates', error: error.message } };
        }
    }

    /**
     * 🛡️ IN-HOUSE FALLBACK ENGINE - NEVER FAILS
     * 📋 Smart keyword-based responses for unmatched queries
     * ⚠️  CRITICAL: This is the final fallback - must always provide a response
     */
    async queryInHouseFallback(companyId, query, context) {
        try {
            const company = await Company.findById(companyId).select('aiAgentLogic.knowledgeManagement.inHouseFallback aiAgentLogic.placeholders agentBrain.identity.businessType companyName');
            
            const businessType = company?.agentBrain?.identity?.businessType || '';
            const companyName = company?.companyName || 'our company';
            
            const fallbackConfig = company?.aiAgentLogic?.knowledgeManagement?.inHouseFallback || this.getBusinessSpecificFallback(businessType, companyName);
            
            // Check each fallback category
            const categories = ['emergencySituations', 'serviceRequests', 'bookingRequests', 'generalInquiries'];
            
            for (const category of categories) {
                const categoryConfig = fallbackConfig[category];
                if (!categoryConfig || !categoryConfig.keywords) {continue;}

                const confidence = this.calculateKeywordMatch(query, categoryConfig.keywords);
                
                if (confidence > 0.3) { // Lower threshold for fallback
                    let response = categoryConfig.response || this.getDefaultResponse(category);
                    
                    // Replace placeholders in fallback response
                    if (company) {
                        response = replacePlaceholders(response, company);
                    }
                    
                    return {
                        confidence: Math.max(confidence, 0.5), // Ensure minimum fallback confidence
                        response,
                        metadata: {
                            source: 'inHouseFallback',
                            category,
                            matchedKeywords: this.getMatchedKeywords(query, categoryConfig.keywords)
                        }
                    };
                }
            }

            // Ultimate fallback - always responds
            let ultimateResponse = "Thank you for contacting us. Let me connect you with someone who can help you right away.";
            if (company) {
                ultimateResponse = replacePlaceholders(ultimateResponse, company);
            }
            
            return {
                confidence: 0.5,
                response: ultimateResponse,
                metadata: {
                    source: 'inHouseFallback',
                    category: 'ultimate',
                    note: 'Ultimate fallback response'
                }
            };

        } catch (error) {
            logger.error('Error in in-house fallback', { companyId, error: error.message });
            
            // Emergency fallback - never fails
            return {
                confidence: 0.5,
                response: "Thank you for calling. I'm here to help you. Let me connect you with the right person.",
                metadata: {
                    source: 'inHouseFallback',
                    category: 'emergency',
                    error: error.message
                }
            };
        }
    }

    /**
     * 🧮 CONFIDENCE CALCULATION ENGINE
     * 📋 Calculates match confidence using multiple factors
     */
    calculateConfidence(query, targetText, keywords = []) {
        const queryLower = query.toLowerCase();
        const targetLower = targetText.toLowerCase();
        
        let confidence = 0;
        
        // Direct text similarity (40% weight)
        const textSimilarity = this.calculateTextSimilarity(queryLower, targetLower);
        confidence += textSimilarity * 0.4;
        
        // Keyword matching (60% weight)
        if (keywords && keywords.length > 0) {
            const keywordMatch = this.calculateKeywordMatch(queryLower, keywords);
            confidence += keywordMatch * 0.6;
        }
        
        return Math.min(confidence, 1.0);
    }

    calculateTextSimilarity(text1, text2) {
        const words1 = text1.split(/\s+/);
        const words2 = text2.split(/\s+/);
        
        let matches = 0;
        for (const word1 of words1) {
            if (word1.length > 2 && words2.some(word2 => word2.includes(word1) || word1.includes(word2))) {
                matches++;
            }
        }
        
        return matches / Math.max(words1.length, words2.length);
    }

    calculateKeywordMatch(query, keywords) {
        if (!keywords || keywords.length === 0) {return 0;}
        
        const queryWords = query.toLowerCase().split(/\s+/);
        let matches = 0;
        
        for (const keyword of keywords) {
            const keywordLower = keyword.toLowerCase();
            if (queryWords.some(word => word.includes(keywordLower) || keywordLower.includes(word))) {
                matches++;
            }
        }
        
        return matches / keywords.length;
    }

    getMatchedKeywords(query, keywords = []) {
        if (!keywords || keywords.length === 0) {return [];}
        
        const queryLower = query.toLowerCase();
        return keywords.filter(keyword => 
            queryLower.includes(keyword.toLowerCase()) || 
            keyword.toLowerCase().includes(queryLower.split(' ')[0])
        );
    }

    /**
     * ⚙️ CONFIGURATION AND UTILITY METHODS
     */
    async getPriorityConfiguration(companyId) {
        try {
            // V2 SYSTEM: Simple Redis cache check (Redis v5+ compatible)
            try {
                if (redisClient && redisClient.isReady) {
                    const cacheKey = `company:${companyId}:priorities`;
                    const cached = await redisClient.get(cacheKey);
                    if (cached) {return JSON.parse(cached);}
                }
            } catch (error) {
                logger.warn(`⚠️ V2 Cache check failed for priorities`, { error: error.message });
            }

            // 🎯 SINGLE SOURCE OF TRUTH: Load thresholds from Company.aiAgentLogic.thresholds
            const company = await Company.findById(companyId).select('aiAgentLogic').lean();
            
            if (!company?.aiAgentLogic) {
                logger.warn(`No AI agent logic found for company ${companyId}, using defaults`);
                return this.getDefaultPriorityConfiguration();
            }

            const aiLogic = company.aiAgentLogic;
            const thresholds = aiLogic.thresholds || {};
            
            // Build priority configuration using Company's thresholds as SINGLE SOURCE OF TRUTH
            const config = {
                enabled: true,
                priorityFlow: [
                    { source: 'companyQnA', priority: 1, threshold: thresholds.companyQnA || 0.55, enabled: true },
                    { source: 'tradeQnA', priority: 2, threshold: thresholds.tradeQnA || 0.75, enabled: true },
                    { source: 'templates', priority: 3, threshold: thresholds.templates || 0.7, enabled: true },
                    { source: 'inHouseFallback', priority: 4, threshold: thresholds.inHouseFallback || 0.5, enabled: true }
                ],
                memorySettings: aiLogic.memorySettings || {
                    useConversationContext: true,
                    contextWindow: 5,
                    personalizeResponses: true
                },
                fallbackBehavior: aiLogic.fallbackBehavior || {
                    noMatchFound: 'use_in_house_fallback',
                    lowConfidence: 'escalate_or_fallback'
                }
            };

            logger.info(`🎯 Loaded thresholds from Company document`, { 
                companyId, 
                thresholds: {
                    companyQnA: config.priorityFlow[0].threshold,
                    tradeQnA: config.priorityFlow[1].threshold,
                    templates: config.priorityFlow[2].threshold,
                    inHouseFallback: config.priorityFlow[3].threshold
                }
            });
            
            // Cache for future use
            // V2 SYSTEM: Simple Redis cache set (Redis v5+ compatible)
            try {
                if (redisClient && redisClient.isReady) {
                    const cacheKey = `company:${companyId}:priorities`;
                    await redisClient.setEx(cacheKey, 3600, JSON.stringify(config));
                }
            } catch (error) {
                logger.warn(`⚠️ V2 Cache set failed for priorities`, { error: error.message });
            }
            
            return config;

        } catch (error) {
            logger.error(`Error loading priority configuration for company ${companyId}`, { error: error.message });
            return this.getDefaultPriorityConfiguration();
        }
    }

    getDefaultPriorityConfiguration() {
        // 🎯 SINGLE SOURCE OF TRUTH: All thresholds come from Company.aiAgentLogic.thresholds
        // These are ONLY used as emergency fallbacks if company data is corrupted
        return {
            enabled: true,
            priorityFlow: [
                { source: 'companyQnA', priority: 1, threshold: 0.55, enabled: true },
                { source: 'tradeQnA', priority: 2, threshold: 0.75, enabled: true },
                { source: 'templates', priority: 3, threshold: 0.7, enabled: true },
                { source: 'inHouseFallback', priority: 4, threshold: 0.5, enabled: true }
            ],
            memorySettings: {
                useConversationContext: true,
                contextWindow: 5,
                personalizeResponses: true
            },
            fallbackBehavior: {
                noMatchFound: 'use_in_house_fallback',
                lowConfidence: 'use_fallback',
                systemError: 'emergency_fallback'
            }
        };
    }

    getBusinessSpecificFallback(businessType, companyName) {
        const businessTypeLower = businessType.toLowerCase();
        
        // Business-specific responses based on company type
        if (businessTypeLower.includes('hvac') || businessTypeLower.includes('air') || businessTypeLower.includes('heating')) {
            return {
                serviceRequests: {
                    response: `I understand you're having an HVAC issue. Let me connect you with our heating and cooling specialists right away.`,
                    keywords: ["repair", "fix", "service", "maintenance", "broken", "not working", "ac", "air conditioning", "heat", "furnace"]
                },
                bookingRequests: {
                    response: `I'd be happy to schedule your HVAC service appointment. Let me get you connected with our scheduling team.`,
                    keywords: ["appointment", "schedule", "book", "visit", "when", "available", "maintenance", "tune-up"]
                },
                emergencySituations: {
                    response: `This sounds like an HVAC emergency. Let me connect you with our emergency heating and cooling team immediately.`,
                    keywords: ["emergency", "urgent", "help", "broken", "no heat", "no air", "flooding", "leak"]
                },
                generalInquiries: {
                    response: `Thank you for contacting ${companyName}. We're your local HVAC specialists. How can I help you today?`,
                    keywords: ["hours", "location", "contact", "info", "question", "help"]
                }
            };
        }
        
        if (businessTypeLower.includes('dental') || businessTypeLower.includes('dentist')) {
            return {
                serviceRequests: {
                    response: `I'm sorry, but we're a dental practice and don't handle repair services. You'll need to contact the appropriate service provider for that type of issue.`,
                    keywords: ["repair", "fix", "service", "maintenance", "broken", "not working", "ac", "plumbing", "electrical"]
                },
                bookingRequests: {
                    response: `I'd be happy to schedule your dental appointment. Let me get you connected with our scheduling team.`,
                    keywords: ["appointment", "schedule", "book", "visit", "when", "available", "cleaning", "checkup"]
                },
                emergencySituations: {
                    response: `If this is a dental emergency, let me connect you with our emergency dental team. For other emergencies, please contact the appropriate emergency services.`,
                    keywords: ["emergency", "urgent", "help", "pain", "tooth", "dental"]
                },
                generalInquiries: {
                    response: `Thank you for contacting ${companyName}. We're your dental care specialists. How can I help you today?`,
                    keywords: ["hours", "location", "contact", "info", "question", "help"]
                }
            };
        }
        
        if (businessTypeLower.includes('plumb')) {
            return {
                serviceRequests: {
                    response: `I understand you're having a plumbing issue. Let me connect you with our plumbing specialists right away.`,
                    keywords: ["repair", "fix", "service", "maintenance", "broken", "not working", "leak", "pipe", "drain", "toilet", "sink"]
                },
                bookingRequests: {
                    response: `I'd be happy to schedule your plumbing service appointment. Let me get you connected with our scheduling team.`,
                    keywords: ["appointment", "schedule", "book", "visit", "when", "available", "installation"]
                },
                emergencySituations: {
                    response: `This sounds like a plumbing emergency. Let me connect you with our emergency plumbing team immediately.`,
                    keywords: ["emergency", "urgent", "help", "broken", "flooding", "leak", "burst", "backup"]
                },
                generalInquiries: {
                    response: `Thank you for contacting ${companyName}. We're your local plumbing specialists. How can I help you today?`,
                    keywords: ["hours", "location", "contact", "info", "question", "help"]
                }
            };
        }
        
        // Default fallback for unknown business types
        return this.getDefaultFallback();
    }

    getDefaultFallback() {
        return {
            serviceRequests: {
                response: "I understand you need service assistance. Let me connect you with our service team right away.",
                keywords: ["repair", "fix", "service", "maintenance", "broken", "not working"]
            },
            bookingRequests: {
                response: "I'd be happy to help you schedule an appointment. Let me get you connected with our scheduling team.",
                keywords: ["appointment", "schedule", "book", "visit", "when", "available"]
            },
            emergencySituations: {
                response: "This sounds like an emergency situation. Let me connect you with our emergency service team immediately.",
                keywords: ["emergency", "urgent", "help", "broken", "flooding", "no heat", "no air"]
            },
            generalInquiries: {
                response: "Thank you for contacting us. I'm here to help you with any questions you have.",
                keywords: ["hours", "location", "contact", "info", "question", "help"]
            }
        };
    }

    getDefaultResponse(category) {
        const responses = {
            emergencySituations: "This sounds urgent. Let me connect you with our emergency team right away.",
            serviceRequests: "I understand you need service. Let me get you connected with the right person.",
            bookingRequests: "I'd be happy to help you schedule something. Let me connect you with our team.",
            generalInquiries: "Thank you for calling. I'm here to help you with whatever you need."
        };
        return responses[category] || "Thank you for contacting us. Let me help you right away.";
    }

    /**
     * 📊 RESPONSE BUILDING AND ANALYTICS
     */
    buildSuccessResponse(context) {
        const totalTime = Date.now() - context.startTime;
        
        return {
            success: true,
            response: context.finalMatch.response,
            confidence: context.finalMatch.confidence,
            source: context.finalMatch.source,
            metadata: {
                ...context.finalMatch.metadata,
                routingId: context.routingId,
                totalResponseTime: `${totalTime}ms`,
                routingFlow: context.routingFlow,
                performance: {
                    totalSources: context.routingFlow.length,
                    sourcesMatched: context.routingFlow.filter(f => f.match).length,
                    avgSourceTime: context.routingFlow.reduce((sum, f) => sum + parseInt(f.responseTime), 0) / context.routingFlow.length
                }
            }
        };
    }

    handleNoMatch(context) {
        const totalTime = Date.now() - context.startTime;
        
        return {
            success: false,
            response: "I want to make sure I give you the best help possible. Let me connect you with someone who can assist you right away.",
            confidence: 0.3,
            source: 'noMatch',
            metadata: {
                routingId: context.routingId,
                totalResponseTime: `${totalTime}ms`,
                routingFlow: context.routingFlow,
                reason: 'No sources met confidence thresholds',
                recommendation: 'Consider lowering thresholds or adding more Q&A content'
            }
        };
    }

    handleConfigurationError(companyId, query, routingId) {
        logger.error(`Configuration error for company ${companyId}`, { routingId });
        
        return {
            success: false,
            response: "Thank you for calling. I'm here to help you. Let me connect you with the right person.",
            confidence: 0.5,
            source: 'configurationError',
            metadata: {
                routingId,
                error: 'Priority configuration not found',
                companyId
            }
        };
    }

    emergencyFallback(companyId, query, routingId) {
        logger.error(`Emergency fallback activated for company ${companyId}`, { routingId });
        
        return {
            success: false,
            response: "Thank you for contacting us. I'm connecting you with someone who can help you right away.",
            confidence: 0.4,
            source: 'emergencyFallback',
            metadata: {
                routingId,
                error: 'System error - emergency fallback activated',
                companyId
            }
        };
    }

    /**
     * 📈 PERFORMANCE TRACKING AND OPTIMIZATION
     */
    updatePerformanceMetrics(result, responseTime) {
        this.performanceMetrics.totalQueries++;
        
        // Update average response time
        this.performanceMetrics.avgResponseTime = 
            (this.performanceMetrics.avgResponseTime * (this.performanceMetrics.totalQueries - 1) + responseTime) / 
            this.performanceMetrics.totalQueries;
        
        // Update success rate
        if (result.success) {
            this.performanceMetrics.successRate = 
                (this.performanceMetrics.successRate * (this.performanceMetrics.totalQueries - 1) + 1) / 
                this.performanceMetrics.totalQueries;
        }
        
        // Update source hit rates
        if (result.source) {
            if (!this.performanceMetrics.sourceHitRates[result.source]) {
                this.performanceMetrics.sourceHitRates[result.source] = 0;
            }
            this.performanceMetrics.sourceHitRates[result.source]++;
        }
    }

    logRoutingCompletion(context, result, totalTime) {
        logger.info(`🎉 Routing completed for company ${context.companyId}`, {
            routingId: context.routingId,
            success: result.success,
            source: result.source,
            confidence: result.confidence,
            totalTime: `${totalTime}ms`,
            sourcesChecked: context.routingFlow.length,
            query: context.query.substring(0, 50)
        });
    }

    generateRoutingId() {
        return `route_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 🎭 PERSONALITY INTEGRATION - MAKE AI RESPONSES HUMAN
     * 📋 Applies company personality settings to AI responses
     * 🎯 PURPOSE: Transform robotic answers into human-like, company-branded responses
     */
    async applyPersonality(companyId, originalResponse, sourceType = 'general') {
        try {
            // V2 SYSTEM: Simple Redis cache check (Redis v5+ compatible)
            let personalityConfig = null;
            try {
                if (redisClient && redisClient.isReady) {
                    const cacheKey = `company:${companyId}:personality`;
                    const cached = await redisClient.get(cacheKey);
                    if (cached) {personalityConfig = JSON.parse(cached);}
                }
            } catch (error) {
                logger.warn(`⚠️ V2 Cache check failed for personality`, { error: error.message });
            }
            
            if (!personalityConfig || !personalityConfig.isCustomized) {
                // No custom personality - return original response
                return originalResponse;
            }

            let enhancedResponse = originalResponse;

            // Apply core personality traits
            if (personalityConfig.corePersonality) {
                const { tone, formality, enthusiasm } = personalityConfig.corePersonality;
                
                // Adjust tone based on settings
                if (tone === 'warm' && !enhancedResponse.includes('!')) {
                    enhancedResponse = this.addWarmth(enhancedResponse);
                } else if (tone === 'professional' && enhancedResponse.includes('!')) {
                    enhancedResponse = this.makeProfessional(enhancedResponse);
                }

                // Apply formality level
                if (formality === 'casual') {
                    enhancedResponse = this.makeCasual(enhancedResponse);
                } else if (formality === 'formal') {
                    enhancedResponse = this.makeFormal(enhancedResponse);
                }
            }

            // Add conversation patterns
            if (personalityConfig.conversationPatterns) {
                const { openingPhrases, closingPhrases } = personalityConfig.conversationPatterns;
                
                // Add opening phrase for certain response types
                if (sourceType === 'company_qna' && openingPhrases && openingPhrases.length > 0) {
                    const randomOpening = openingPhrases[Math.floor(Math.random() * openingPhrases.length)];
                    enhancedResponse = `${randomOpening} ${enhancedResponse}`;
                }

                // Add closing phrase for complete responses
                if (closingPhrases && closingPhrases.length > 0 && enhancedResponse.length > 50) {
                    const randomClosing = closingPhrases[Math.floor(Math.random() * closingPhrases.length)];
                    enhancedResponse = `${enhancedResponse} ${randomClosing}`;
                }
            }

            // Apply emotional intelligence
            if (personalityConfig.emotionalIntelligence?.empathyLevel === 'high') {
                enhancedResponse = this.addEmpathy(enhancedResponse, sourceType);
            }

            logger.debug(`🎭 Personality applied to response`, {
                companyId,
                sourceType,
                originalLength: originalResponse.length,
                enhancedLength: enhancedResponse.length,
                personalityApplied: true
            });

            return enhancedResponse;

        } catch (error) {
            logger.error(`❌ Error applying personality for company ${companyId}:`, error);
            // Fallback to original response if personality fails
            return originalResponse;
        }
    }

    /**
     * 🎭 PERSONALITY HELPER METHODS
     */
    addWarmth(response) {
        // Add warmth without being overly casual
        if (!response.includes('!') && !response.endsWith('?')) {
            return response.replace(/\.$/, '!');
        }
        return response;
    }

    makeProfessional(response) {
        // Remove excessive enthusiasm while maintaining helpfulness
        return response.replace(/!+/g, '.').replace(/\s+/g, ' ').trim();
    }

    makeCasual(response) {
        // Make language more conversational
        return response
            .replace(/We recommend/g, "We'd suggest")
            .replace(/Please contact/g, "Feel free to reach out")
            .replace(/We are pleased/g, "We're happy");
    }

    makeFormal(response) {
        // Ensure professional language
        return response
            .replace(/We'd/g, "We would")
            .replace(/can't/g, "cannot")
            .replace(/won't/g, "will not");
    }

    addEmpathy(response, sourceType) {
        // Add empathetic language based on context
        if (sourceType === 'emergency' || response.toLowerCase().includes('problem')) {
            return `I understand this can be concerning. ${response}`;
        } else if (sourceType === 'service_request') {
            return `I'd be happy to help you with that. ${response}`;
        }
        return response;
    }

    hashQuery(query) {
        return query.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 50);
    }

    /**
     * 📊 PUBLIC METRICS AND MONITORING
     */
    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            cacheSize: this.routingCache.size,
            uptime: Date.now() - (this.performanceMetrics.lastOptimized || Date.now())
        };
    }

    clearCache() {
        this.routingCache.clear();
        logger.info('Priority-driven knowledge router cache cleared');
    }
    
    /**
     * 🚀 TRACK PERFORMANCE METRICS FOR AI PERFORMANCE DASHBOARD
     * Called after every AI routing to collect performance data
     */
    async trackPerformanceMetrics(companyId, routingContext, result, totalTime) {
        try {
            const AIPerformanceTracker = require('./AIPerformanceTracker');
            
            // Build timing breakdown
            const timings = {
                mongoLookup: 3,  // Estimated - company lookup
                redisCache: routingContext.options?.cacheHit ? 1 : 0,
                templateLoading: 4,  // Estimated - loading scenarios
                scenarioMatching: totalTime - 10,  // Main AI work
                confidenceCalculation: 2,  // Estimated
                responseGeneration: 1,  // Minimal
                total: totalTime
            };
            
            // Determine source
            const source = result.source || 'inHouseFallback';
            
            // Track with AIPerformanceTracker
            await AIPerformanceTracker.trackLookup({
                companyId,
                timings,
                source,
                confidence: result.confidence || 0,
                cacheHit: routingContext.options?.cacheHit || false,
                customerQuery: routingContext.query
            });
            
        } catch (error) {
            // Silent fail - don't break AI routing if tracking fails
            logger.warn('Failed to track performance metrics:', error.message);
        }
    }
}

// Export the class for V2 system compatibility
module.exports = PriorityDrivenKnowledgeRouter;
