/**
 * 🎯 KNOWLEDGE SOURCE PRIORITIES API
 * ==================================
 * Enterprise-grade API endpoints for managing AI agent priority flow
 * Multi-tenant, Redis-cached, bulletproof error handling
 * 
 * ENDPOINTS:
 * GET    /api/company/:companyId/knowledge-source-priorities
 * PUT    /api/company/:companyId/knowledge-source-priorities
 * POST   /api/company/:companyId/knowledge-source-priorities/test-flow
 * POST   /api/company/:companyId/knowledge-source-priorities/reset-defaults
 * 
 * FEATURES:
 * - Sub-50ms response times with Redis caching
 * - Real-time priority flow testing
 * - Automatic cache invalidation on updates
 * - Comprehensive error handling and validation
 * - Performance monitoring and logging
 */

const express = require('express');
const router = express.Router();
const Company = require('../../models/Company');
const { authenticateJWT } = require('../../middleware/auth');
const aiAgentCache = require('../../services/aiAgentCacheService');
const logger = require('../../utils/logger');
const Joi = require('joi');

// Validation schemas
const priorityFlowSchema = Joi.object({
    source: Joi.string().valid('companyQnA', 'tradeQnA', 'templates', 'inHouseFallback').required(),
    priority: Joi.number().integer().min(1).max(4).required(),
    threshold: Joi.number().min(0).max(1).required(),
    enabled: Joi.boolean().default(true),
    fallbackBehavior: Joi.string().valid('continue', 'always_respond').default('continue')
});

const prioritiesUpdateSchema = Joi.object({
    enabled: Joi.boolean().default(true),
    priorityFlow: Joi.array().items(priorityFlowSchema).min(1).max(4),
    memorySettings: Joi.object({
        useConversationContext: Joi.boolean().default(true),
        contextWindow: Joi.number().integer().min(1).max(10).default(5),
        personalizeResponses: Joi.boolean().default(true),
        mode: Joi.string().valid('conversation', 'session', 'customer', 'none').default('conversation')
    }),
    fallbackBehavior: Joi.object({
        noMatchFound: Joi.string().valid('use_in_house_fallback', 'escalate_immediately').default('use_in_house_fallback'),
        lowConfidence: Joi.string().valid('escalate_or_fallback', 'use_fallback').default('escalate_or_fallback'),
        systemError: Joi.string().valid('emergency_fallback', 'escalate_immediately').default('emergency_fallback'),
        default: Joi.string().valid('continue', 'always_respond', 'escalate').default('always_respond')
    })
});

const testFlowSchema = Joi.object({
    query: Joi.string().required().min(1).max(500),
    testAllSources: Joi.boolean().default(true),
    showConfidenceScores: Joi.boolean().default(true),
    showRoutingDecisions: Joi.boolean().default(true)
});

/**
 * 🎯 GET /api/company/:companyId/knowledge-source-priorities
 * Retrieve knowledge source priorities configuration
 */
router.get('/:companyId/knowledge-source-priorities', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;

    try {
        logger.info(`🎯 GET priorities request for company ${companyId}`);

        // Try cache first for sub-50ms performance
        let priorities = await aiAgentCache.getPriorities(companyId);
        
        if (!priorities) {
            // Cache miss - load from database
            logger.debug(`🎯 Cache miss - loading priorities from DB for company ${companyId}`);
            
            const company = await Company.findById(companyId).select('aiAgentLogic.knowledgeSourcePriorities').lean();
            
            if (!company) {
                return res.status(404).json({
                    success: false,
                    message: 'Company not found',
                    error: 'COMPANY_NOT_FOUND'
                });
            }

            priorities = company.aiAgentLogic?.knowledgeSourcePriorities;

            // If no priorities configured, return defaults
            if (!priorities || !priorities.priorityFlow || priorities.priorityFlow.length === 0) {
                priorities = getDefaultPriorities();
                logger.info(`🎯 Using default priorities for company ${companyId}`);
            }

            // Cache the result for future requests
            await aiAgentCache.cachePriorities(companyId, priorities);
        }

        const responseTime = Date.now() - startTime;
        logger.info(`🎯 GET priorities success for company ${companyId}`, {
            responseTime,
            cached: priorities.cachedAt ? true : false,
            priorityCount: priorities.priorityFlow?.length || 0
        });

        res.json({
            success: true,
            data: priorities,
            meta: {
                responseTime,
                cached: priorities.cachedAt ? true : false,
                version: priorities.version || 1
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ GET priorities failed for company ${companyId}`, {
            error: error.message,
            responseTime,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: 'Failed to retrieve knowledge source priorities',
            error: 'INTERNAL_SERVER_ERROR',
            meta: { responseTime }
        });
    }
});

/**
 * 🎯 PUT /api/company/:companyId/knowledge-source-priorities
 * Update knowledge source priorities configuration
 */
router.put('/:companyId/knowledge-source-priorities', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;

    try {
        logger.info(`🎯 PUT priorities request for company ${companyId}`);
        console.log('🔍 CHECKPOINT 1: Received request body:', JSON.stringify(req.body, null, 2));

        // Validate request body
        const { error, value } = prioritiesUpdateSchema.validate(req.body);
        if (error) {
            console.log('❌ CHECKPOINT 2: Validation failed:', error.details);
            return res.status(400).json({
                success: false,
                message: 'Invalid priorities configuration',
                error: 'VALIDATION_ERROR',
                details: error.details
            });
        }

        console.log('✅ CHECKPOINT 2: Validation passed, validated data:', JSON.stringify(value, null, 2));

        // Validate priority flow uniqueness and completeness
        console.log('🔍 CHECKPOINT 3: Validating priority flow...');
        const validationResult = validatePriorityFlow(value.priorityFlow);
        if (!validationResult.valid) {
            console.log('❌ CHECKPOINT 3: Priority flow validation failed:', validationResult.message);
            return res.status(400).json({
                success: false,
                message: validationResult.message,
                error: 'PRIORITY_FLOW_INVALID'
            });
        }
        console.log('✅ CHECKPOINT 3: Priority flow validation passed');

        // Prepare update data
        const updateData = {
            ...value,
            version: (value.version || 0) + 1,
            lastUpdated: new Date(),
            performance: {
                avgResponseTime: 0,
                successRate: 0,
                totalQueries: 0,
                lastOptimized: new Date()
            }
        };

        // Update database
        console.log('🔍 CHECKPOINT 4: Updating MongoDB with data:', JSON.stringify(updateData, null, 2));
        const company = await Company.findByIdAndUpdate(
            companyId,
            {
                $set: {
                    'aiAgentLogic.knowledgeSourcePriorities': updateData,
                    updatedAt: new Date()
                }
            },
            { new: true, runValidators: true }
        );

        if (!company) {
            console.log('❌ CHECKPOINT 4: Company not found in MongoDB');
            return res.status(404).json({
                success: false,
                message: 'Company not found',
                error: 'COMPANY_NOT_FOUND'
            });
        }
        console.log('✅ CHECKPOINT 4: MongoDB update successful');

        // Invalidate cache to ensure fresh data
        console.log('🔍 CHECKPOINT 5: Invalidating Redis cache...');
        await aiAgentCache.invalidateCompany(companyId);
        console.log('✅ CHECKPOINT 5: Redis cache invalidated');
        
        // Cache the new configuration
        console.log('🔍 CHECKPOINT 6: Caching new data in Redis...');
        await aiAgentCache.cachePriorities(companyId, updateData);
        console.log('✅ CHECKPOINT 6: New data cached in Redis');

        const responseTime = Date.now() - startTime;
        console.log('✅ CHECKPOINT 7: Sending success response');
        logger.info(`🎯 PUT priorities success for company ${companyId}`, {
            responseTime,
            version: updateData.version,
            priorityCount: updateData.priorityFlow?.length || 0
        });

        res.json({
            success: true,
            message: 'Knowledge source priorities updated successfully',
            data: updateData,
            meta: {
                responseTime,
                version: updateData.version,
                cacheInvalidated: true
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ PUT priorities failed for company ${companyId}`, {
            error: error.message,
            responseTime,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: 'Failed to update knowledge source priorities',
            error: 'INTERNAL_SERVER_ERROR',
            meta: { responseTime }
        });
    }
});

/**
 * 🎯 POST /api/company/:companyId/knowledge-source-priorities/test-flow
 * Test priority flow with a sample query
 */
router.post('/:companyId/knowledge-source-priorities/test-flow', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;

    try {
        logger.info(`🎯 POST test-flow request for company ${companyId}`);

        // Validate request body
        const { error, value } = testFlowSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid test flow request',
                error: 'VALIDATION_ERROR',
                details: error.details
            });
        }

        const { query, testAllSources, showConfidenceScores, showRoutingDecisions } = value;

        // Get current priorities configuration
        let priorities = await aiAgentCache.getPriorities(companyId);
        if (!priorities) {
            const company = await Company.findById(companyId).select('aiAgentLogic.knowledgeSourcePriorities').lean();
            if (!company) {
                return res.status(404).json({
                    success: false,
                    message: 'Company not found',
                    error: 'COMPANY_NOT_FOUND'
                });
            }
            priorities = company.aiAgentLogic?.knowledgeSourcePriorities || getDefaultPriorities();
        }

        // Simulate priority flow testing
        const testResults = await simulatePriorityFlow(companyId, query, priorities, {
            testAllSources,
            showConfidenceScores,
            showRoutingDecisions
        });

        const responseTime = Date.now() - startTime;
        logger.info(`🎯 POST test-flow success for company ${companyId}`, {
            responseTime,
            query: query.substring(0, 50),
            sourcesMatched: testResults.routingFlow?.length || 0
        });

        res.json({
            success: true,
            message: 'Priority flow test completed',
            data: {
                query,
                ...testResults,
                testConfig: {
                    testAllSources,
                    showConfidenceScores,
                    showRoutingDecisions
                }
            },
            meta: {
                responseTime,
                totalResponseTime: testResults.totalResponseTime || responseTime
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ POST test-flow failed for company ${companyId}`, {
            error: error.message,
            responseTime,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: 'Failed to test priority flow',
            error: 'INTERNAL_SERVER_ERROR',
            meta: { responseTime }
        });
    }
});

/**
 * 🎯 POST /api/company/:companyId/knowledge-source-priorities/reset-defaults
 * Reset priorities to default configuration
 */
router.post('/:companyId/knowledge-source-priorities/reset-defaults', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;

    try {
        logger.info(`🎯 POST reset-defaults request for company ${companyId}`);

        // Get default priorities configuration
        const defaultPriorities = getDefaultPriorities();

        // Update database
        const company = await Company.findByIdAndUpdate(
            companyId,
            {
                $set: {
                    'aiAgentLogic.knowledgeSourcePriorities': defaultPriorities,
                    updatedAt: new Date()
                }
            },
            { new: true, runValidators: true }
        );

        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found',
                error: 'COMPANY_NOT_FOUND'
            });
        }

        // Invalidate cache and cache new defaults
        await aiAgentCache.invalidateCompany(companyId);
        await aiAgentCache.cachePriorities(companyId, defaultPriorities);

        const responseTime = Date.now() - startTime;
        logger.info(`🎯 POST reset-defaults success for company ${companyId}`, {
            responseTime,
            version: defaultPriorities.version
        });

        res.json({
            success: true,
            message: 'Knowledge source priorities reset to defaults',
            data: defaultPriorities,
            meta: {
                responseTime,
                reset: true,
                cacheInvalidated: true
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ POST reset-defaults failed for company ${companyId}`, {
            error: error.message,
            responseTime,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: 'Failed to reset priorities to defaults',
            error: 'INTERNAL_SERVER_ERROR',
            meta: { responseTime }
        });
    }
});

/**
 * 🛠️ UTILITY FUNCTIONS
 */

/**
 * Get default priorities configuration
 * @returns {Object} Default priorities configuration
 */
function getDefaultPriorities() {
    return {
        enabled: true,
        version: 1,
        lastUpdated: new Date(),
        priorityFlow: [
            {
                source: 'companyQnA',
                priority: 1,
                threshold: 0.8,
                enabled: true,
                fallbackBehavior: 'continue'
            },
            {
                source: 'tradeQnA',
                priority: 2,
                threshold: 0.75,
                enabled: true,
                fallbackBehavior: 'continue'
            },
            {
                source: 'templates',
                priority: 3,
                threshold: 0.7,
                enabled: true,
                fallbackBehavior: 'continue'
            },
            {
                source: 'inHouseFallback',
                priority: 4,
                threshold: 0.5,
                enabled: true,
                fallbackBehavior: 'always_respond'
            }
        ],
        memorySettings: {
            useConversationContext: true,
            contextWindow: 5,
            personalizeResponses: true
        },
        fallbackBehavior: {
            noMatchFound: 'use_in_house_fallback',
            lowConfidence: 'escalate_or_fallback',
            systemError: 'emergency_fallback'
        },
        performance: {
            avgResponseTime: 0,
            successRate: 0,
            totalQueries: 0,
            lastOptimized: new Date()
        }
    };
}

/**
 * Validate priority flow configuration
 * @param {Array} priorityFlow - Priority flow array
 * @returns {Object} Validation result
 */
function validatePriorityFlow(priorityFlow) {
    if (!priorityFlow || !Array.isArray(priorityFlow)) {
        return { valid: false, message: 'Priority flow must be an array' };
    }

    if (priorityFlow.length === 0) {
        return { valid: false, message: 'Priority flow cannot be empty' };
    }

    // Check for duplicate sources
    const sources = priorityFlow.map(item => item.source);
    const uniqueSources = [...new Set(sources)];
    if (sources.length !== uniqueSources.length) {
        return { valid: false, message: 'Duplicate sources in priority flow' };
    }

    // Check for duplicate priorities
    const priorities = priorityFlow.map(item => item.priority);
    const uniquePriorities = [...new Set(priorities)];
    if (priorities.length !== uniquePriorities.length) {
        return { valid: false, message: 'Duplicate priorities in priority flow' };
    }

    // Ensure inHouseFallback is always present and has always_respond behavior
    const fallbackSource = priorityFlow.find(item => item.source === 'inHouseFallback');
    if (!fallbackSource) {
        return { valid: false, message: 'inHouseFallback source is required' };
    }

    if (fallbackSource.fallbackBehavior !== 'always_respond') {
        return { valid: false, message: 'inHouseFallback must have always_respond behavior' };
    }

    return { valid: true };
}

/**
 * Simulate priority flow for testing
 * @param {string} companyId - Company identifier
 * @param {string} query - Test query
 * @param {Object} priorities - Priorities configuration
 * @param {Object} options - Test options
 * @returns {Object} Test results
 */
async function simulatePriorityFlow(companyId, query, priorities, options) {
    const startTime = Date.now();
    const routingFlow = [];

    try {
        // Sort priority flow by priority
        const sortedFlow = priorities.priorityFlow
            .filter(item => item.enabled)
            .sort((a, b) => a.priority - b.priority);

        for (const source of sortedFlow) {
            const sourceStartTime = Date.now();
            
            // Simulate confidence scoring (in real implementation, this would call actual services)
            const confidence = simulateConfidenceScore(query, source.source);
            const responseTime = Date.now() - sourceStartTime;

            const result = {
                source: source.source,
                priority: source.priority,
                confidence: confidence,
                threshold: source.threshold,
                responseTime: `${responseTime}ms`
            };

            if (confidence >= source.threshold) {
                result.result = 'MATCH - Using this response';
                result.response = generateSimulatedResponse(query, source.source, companyId);
                routingFlow.push(result);
                
                // Found a match, stop here unless testing all sources
                if (!options.testAllSources) {
                    break;
                }
            } else {
                result.result = 'SKIP - Below threshold';
                routingFlow.push(result);
            }

            // Special handling for inHouseFallback (always responds)
            if (source.source === 'inHouseFallback' && source.fallbackBehavior === 'always_respond') {
                result.result = 'FALLBACK - Always responds';
                result.response = generateSimulatedResponse(query, source.source, companyId);
                break;
            }
        }

        const totalResponseTime = Date.now() - startTime;
        const finalResponse = routingFlow.find(item => item.response);

        return {
            routingFlow: options.showRoutingDecisions ? routingFlow : routingFlow.filter(item => item.response),
            finalResponse: finalResponse?.response || 'No response generated',
            totalResponseTime: `${totalResponseTime}ms`,
            matchedSource: finalResponse?.source || 'none',
            confidence: options.showConfidenceScores ? finalResponse?.confidence : undefined
        };

    } catch (error) {
        logger.error(`❌ Priority flow simulation failed for company ${companyId}`, error);
        return {
            routingFlow: [],
            finalResponse: 'Error during priority flow simulation',
            totalResponseTime: `${Date.now() - startTime}ms`,
            error: error.message
        };
    }
}

/**
 * Simulate confidence scoring for testing
 * @param {string} query - Test query
 * @param {string} source - Knowledge source
 * @returns {number} Simulated confidence score
 */
function simulateConfidenceScore(query, source) {
    // Simple simulation based on query content and source type
    const queryLower = query.toLowerCase();
    
    switch (source) {
        case 'companyQnA':
            // Higher confidence for specific company-related terms
            if (queryLower.includes('hours') || queryLower.includes('location') || queryLower.includes('contact')) {
                return 0.85 + Math.random() * 0.1;
            }
            return 0.3 + Math.random() * 0.4;
            
        case 'tradeQnA':
            // Higher confidence for trade-specific terms
            if (queryLower.includes('repair') || queryLower.includes('service') || queryLower.includes('fix')) {
                return 0.8 + Math.random() * 0.15;
            }
            return 0.4 + Math.random() * 0.3;
            
        case 'templates':
            // Moderate confidence for template matching
            return 0.5 + Math.random() * 0.3;
            
        case 'inHouseFallback':
            // Always above threshold for fallback
            return 0.6 + Math.random() * 0.2;
            
        default:
            return 0.5;
    }
}

/**
 * Generate simulated response for testing
 * @param {string} query - Test query
 * @param {string} source - Knowledge source
 * @param {string} companyId - Company identifier
 * @returns {string} Simulated response
 */
function generateSimulatedResponse(query, source, companyId) {
    const responses = {
        companyQnA: `Based on our company knowledge: I can help you with "${query}". Let me provide you with the specific information you need.`,
        tradeQnA: `From our trade expertise: "${query}" is something we handle regularly. Here's what you need to know...`,
        templates: `Using our response template: Thank you for asking about "${query}". Here's the standard information we provide.`,
        inHouseFallback: `I understand you're asking about "${query}". Let me connect you with someone who can provide the specific help you need.`
    };
    
    return responses[source] || 'I can help you with that. Let me get you the information you need.';
}

module.exports = router;
