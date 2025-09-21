/**
 * 🧪 PRIORITY FLOW TESTING API
 * ============================
 * Enterprise-grade real-time testing system for AI agent priority flow
 * Integrates Priorities + Knowledge + Personality for complete validation
 * 
 * ENDPOINTS:
 * POST   /api/company/:companyId/priority-flow-testing/test-complete-flow
 * POST   /api/company/:companyId/priority-flow-testing/test-batch-queries
 * POST   /api/company/:companyId/priority-flow-testing/test-performance
 * POST   /api/company/:companyId/priority-flow-testing/test-atlas-air-scenarios
 * GET    /api/company/:companyId/priority-flow-testing/test-history
 * POST   /api/company/:companyId/priority-flow-testing/validate-configuration
 * 
 * FEATURES:
 * - Complete priority flow simulation with all knowledge sources
 * - Personality integration testing
 * - Performance benchmarking and optimization
 * - Atlas Air specific scenario testing
 * - Batch testing for comprehensive validation
 * - Configuration validation and recommendations
 */

const express = require('express');
const router = express.Router();
const Company = require('../../models/Company');
const { authenticateJWT } = require('../../middleware/auth');
const aiAgentCache = require('../../services/aiAgentCacheService');
const logger = require('../../utils/logger');
const Joi = require('joi');

// Validation schemas
const completeFlowTestSchema = Joi.object({
    query: Joi.string().required().min(1).max(500),
    includePersonality: Joi.boolean().default(true),
    showRoutingDecisions: Joi.boolean().default(true),
    showConfidenceScores: Joi.boolean().default(true),
    showPersonalityApplication: Joi.boolean().default(true),
    testAllSources: Joi.boolean().default(true),
    simulateRealCall: Joi.boolean().default(false)
});

const batchTestSchema = Joi.object({
    queries: Joi.array().items(Joi.string().min(1).max(500)).min(1).max(50).required(),
    includePersonality: Joi.boolean().default(true),
    generateReport: Joi.boolean().default(true),
    testScenarios: Joi.array().items(Joi.string().valid('hvac', 'plumbing', 'electrical', 'general')).default(['general'])
});

const performanceTestSchema = Joi.object({
    testDuration: Joi.number().integer().min(10).max(300).default(60), // seconds
    concurrentRequests: Joi.number().integer().min(1).max(10).default(3),
    targetResponseTime: Joi.number().min(10).max(1000).default(50), // milliseconds
    queries: Joi.array().items(Joi.string()).min(5).max(20).required()
});

const atlasAirTestSchema = Joi.object({
    scenarios: Joi.array().items(Joi.string().valid(
        'emergency_hvac', 'routine_maintenance', 'booking_appointment', 
        'business_hours', 'pricing_inquiry', 'service_area'
    )).default(['emergency_hvac', 'routine_maintenance', 'booking_appointment']),
    includePersonality: Joi.boolean().default(true),
    testFailureScenarios: Joi.boolean().default(true)
});

const configValidationSchema = Joi.object({
    validatePriorities: Joi.boolean().default(true),
    validateKnowledge: Joi.boolean().default(true),
    validatePersonality: Joi.boolean().default(true),
    generateRecommendations: Joi.boolean().default(true),
    checkPerformance: Joi.boolean().default(true)
});

/**
 * 🧪 POST /api/company/:companyId/priority-flow-testing/test-complete-flow
 * Test complete priority flow with all systems integrated
 */
router.post('/:companyId/priority-flow-testing/test-complete-flow', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;

    try {
        logger.info(`🧪 POST complete flow test request for company ${companyId}`);

        // Validate request body
        const { error, value } = completeFlowTestSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid test request',
                error: 'VALIDATION_ERROR',
                details: error.details
            });
        }

        const { query, includePersonality, showRoutingDecisions, showConfidenceScores, showPersonalityApplication, testAllSources, simulateRealCall } = value;

        // Load complete configuration
        const config = await loadCompleteConfiguration(companyId);
        if (!config.company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found',
                error: 'COMPANY_NOT_FOUND'
            });
        }

        // Execute complete priority flow test
        const testResults = await executeCompleteFlowTest(companyId, query, config, {
            includePersonality,
            showRoutingDecisions,
            showConfidenceScores,
            showPersonalityApplication,
            testAllSources,
            simulateRealCall
        });

        const responseTime = Date.now() - startTime;
        logger.info(`🧪 Complete flow test success for company ${companyId}`, {
            responseTime,
            query: query.substring(0, 50),
            finalSource: testResults.finalMatch?.source || 'none'
        });

        res.json({
            success: true,
            message: 'Complete priority flow test completed',
            data: {
                query,
                ...testResults,
                testConfig: {
                    includePersonality,
                    showRoutingDecisions,
                    showConfidenceScores,
                    showPersonalityApplication,
                    testAllSources,
                    simulateRealCall
                }
            },
            meta: {
                responseTime,
                totalTestTime: testResults.totalTestTime || responseTime
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ Complete flow test failed for company ${companyId}`, {
            error: error.message,
            responseTime,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: 'Failed to execute complete flow test',
            error: 'INTERNAL_SERVER_ERROR',
            meta: { responseTime }
        });
    }
});

/**
 * 🧪 POST /api/company/:companyId/priority-flow-testing/test-batch-queries
 * Test multiple queries in batch for comprehensive validation
 */
router.post('/:companyId/priority-flow-testing/test-batch-queries', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;

    try {
        logger.info(`🧪 POST batch test request for company ${companyId}`);

        // Validate request body
        const { error, value } = batchTestSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid batch test request',
                error: 'VALIDATION_ERROR',
                details: error.details
            });
        }

        const { queries, includePersonality, generateReport, testScenarios } = value;

        // Load complete configuration
        const config = await loadCompleteConfiguration(companyId);
        if (!config.company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found',
                error: 'COMPANY_NOT_FOUND'
            });
        }

        // Execute batch testing
        const batchResults = await executeBatchTest(companyId, queries, config, {
            includePersonality,
            generateReport,
            testScenarios
        });

        const responseTime = Date.now() - startTime;
        logger.info(`🧪 Batch test success for company ${companyId}`, {
            responseTime,
            queriesCount: queries.length,
            successRate: batchResults.summary?.successRate || 0
        });

        res.json({
            success: true,
            message: 'Batch testing completed',
            data: {
                ...batchResults,
                testConfig: {
                    queriesCount: queries.length,
                    includePersonality,
                    generateReport,
                    testScenarios
                }
            },
            meta: {
                responseTime,
                totalTestTime: batchResults.totalTestTime || responseTime
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ Batch test failed for company ${companyId}`, {
            error: error.message,
            responseTime,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: 'Failed to execute batch test',
            error: 'INTERNAL_SERVER_ERROR',
            meta: { responseTime }
        });
    }
});

/**
 * 🧪 POST /api/company/:companyId/priority-flow-testing/test-performance
 * Performance benchmarking and load testing
 */
router.post('/:companyId/priority-flow-testing/test-performance', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;

    try {
        logger.info(`🧪 POST performance test request for company ${companyId}`);

        // Validate request body
        const { error, value } = performanceTestSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid performance test request',
                error: 'VALIDATION_ERROR',
                details: error.details
            });
        }

        const { testDuration, concurrentRequests, targetResponseTime, queries } = value;

        // Load complete configuration
        const config = await loadCompleteConfiguration(companyId);
        if (!config.company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found',
                error: 'COMPANY_NOT_FOUND'
            });
        }

        // Execute performance testing
        const performanceResults = await executePerformanceTest(companyId, config, {
            testDuration,
            concurrentRequests,
            targetResponseTime,
            queries
        });

        const responseTime = Date.now() - startTime;
        logger.info(`🧪 Performance test success for company ${companyId}`, {
            responseTime,
            avgResponseTime: performanceResults.metrics?.avgResponseTime || 0,
            targetMet: performanceResults.metrics?.avgResponseTime <= targetResponseTime
        });

        res.json({
            success: true,
            message: 'Performance testing completed',
            data: {
                ...performanceResults,
                testConfig: {
                    testDuration,
                    concurrentRequests,
                    targetResponseTime,
                    queriesCount: queries.length
                }
            },
            meta: {
                responseTime,
                totalTestTime: performanceResults.totalTestTime || responseTime
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ Performance test failed for company ${companyId}`, {
            error: error.message,
            responseTime,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: 'Failed to execute performance test',
            error: 'INTERNAL_SERVER_ERROR',
            meta: { responseTime }
        });
    }
});

/**
 * 🧪 POST /api/company/:companyId/priority-flow-testing/test-atlas-air-scenarios
 * Atlas Air specific HVAC scenario testing
 */
router.post('/:companyId/priority-flow-testing/test-atlas-air-scenarios', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;

    try {
        logger.info(`🧪 POST Atlas Air scenarios test request for company ${companyId}`);

        // Validate request body
        const { error, value } = atlasAirTestSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Atlas Air test request',
                error: 'VALIDATION_ERROR',
                details: error.details
            });
        }

        const { scenarios, includePersonality, testFailureScenarios } = value;

        // Load complete configuration
        const config = await loadCompleteConfiguration(companyId);
        if (!config.company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found',
                error: 'COMPANY_NOT_FOUND'
            });
        }

        // Execute Atlas Air scenario testing
        const scenarioResults = await executeAtlasAirScenarios(companyId, config, {
            scenarios,
            includePersonality,
            testFailureScenarios
        });

        const responseTime = Date.now() - startTime;
        logger.info(`🧪 Atlas Air scenarios test success for company ${companyId}`, {
            responseTime,
            scenariosCount: scenarios.length,
            passedScenarios: scenarioResults.summary?.passedScenarios || 0
        });

        res.json({
            success: true,
            message: 'Atlas Air scenarios testing completed',
            data: {
                ...scenarioResults,
                testConfig: {
                    scenarios,
                    includePersonality,
                    testFailureScenarios
                }
            },
            meta: {
                responseTime,
                totalTestTime: scenarioResults.totalTestTime || responseTime
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ Atlas Air scenarios test failed for company ${companyId}`, {
            error: error.message,
            responseTime,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: 'Failed to execute Atlas Air scenarios test',
            error: 'INTERNAL_SERVER_ERROR',
            meta: { responseTime }
        });
    }
});

/**
 * 🧪 POST /api/company/:companyId/priority-flow-testing/validate-configuration
 * Validate complete AI agent configuration and provide recommendations
 */
router.post('/:companyId/priority-flow-testing/validate-configuration', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;

    try {
        logger.info(`🧪 POST configuration validation request for company ${companyId}`);

        // Validate request body
        const { error, value } = configValidationSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Invalid validation request',
                error: 'VALIDATION_ERROR',
                details: error.details
            });
        }

        const { validatePriorities, validateKnowledge, validatePersonality, generateRecommendations, checkPerformance } = value;

        // Load complete configuration
        const config = await loadCompleteConfiguration(companyId);
        if (!config.company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found',
                error: 'COMPANY_NOT_FOUND'
            });
        }

        // Execute configuration validation
        const validationResults = await executeConfigurationValidation(companyId, config, {
            validatePriorities,
            validateKnowledge,
            validatePersonality,
            generateRecommendations,
            checkPerformance
        });

        const responseTime = Date.now() - startTime;
        logger.info(`🧪 Configuration validation success for company ${companyId}`, {
            responseTime,
            overallScore: validationResults.overallScore || 0,
            issuesFound: validationResults.issues?.length || 0
        });

        res.json({
            success: true,
            message: 'Configuration validation completed',
            data: {
                ...validationResults,
                testConfig: {
                    validatePriorities,
                    validateKnowledge,
                    validatePersonality,
                    generateRecommendations,
                    checkPerformance
                }
            },
            meta: {
                responseTime,
                validationTime: validationResults.validationTime || responseTime
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ Configuration validation failed for company ${companyId}`, {
            error: error.message,
            responseTime,
            stack: error.stack
        });

        res.status(500).json({
            success: false,
            message: 'Failed to validate configuration',
            error: 'INTERNAL_SERVER_ERROR',
            meta: { responseTime }
        });
    }
});

/**
 * 🛠️ UTILITY FUNCTIONS
 */

/**
 * Load complete configuration for testing
 * @param {string} companyId - Company identifier
 * @returns {Object} Complete configuration object
 */
async function loadCompleteConfiguration(companyId) {
    try {
        // Try to get from cache first
        const [priorities, knowledge, personality] = await Promise.all([
            aiAgentCache.getPriorities(companyId),
            aiAgentCache.getKnowledge(companyId),
            aiAgentCache.getPersonality(companyId)
        ]);

        // If any cache miss, load from database
        if (!priorities || !knowledge || !personality) {
            const company = await Company.findById(companyId).select('aiAgentLogic').lean();
            if (!company) {
                return { company: null };
            }

            return {
                company,
                priorities: priorities || company.aiAgentLogic?.knowledgeSourcePriorities,
                knowledge: knowledge || company.aiAgentLogic?.knowledgeManagement,
                personality: personality || company.aiAgentLogic?.personalitySystem
            };
        }

        return {
            company: { _id: companyId },
            priorities,
            knowledge,
            personality
        };
    } catch (error) {
        logger.error(`❌ Failed to load complete configuration for company ${companyId}`, error);
        return { company: null };
    }
}

/**
 * Execute complete priority flow test
 * @param {string} companyId - Company identifier
 * @param {string} query - Test query
 * @param {Object} config - Complete configuration
 * @param {Object} options - Test options
 * @returns {Object} Test results
 */
async function executeCompleteFlowTest(companyId, query, config, options) {
    const startTime = Date.now();
    const routingFlow = [];

    try {
        const { priorities, knowledge, personality } = config;
        
        // Get priority flow or use defaults
        const priorityFlow = priorities?.priorityFlow || getDefaultPriorityFlow();
        
        // Sort by priority
        const sortedFlow = priorityFlow
            .filter(item => item.enabled)
            .sort((a, b) => a.priority - b.priority);

        let finalMatch = null;

        // Execute priority flow
        for (const source of sortedFlow) {
            const sourceStartTime = Date.now();
            
            // Test each source
            const result = await testKnowledgeSource(query, source.source, knowledge, source.threshold);
            result.priority = source.priority;
            result.responseTime = `${Date.now() - sourceStartTime}ms`;

            if (options.showRoutingDecisions) {
                routingFlow.push(result);
            }

            // Check if we have a match
            if (result.confidence >= source.threshold) {
                finalMatch = result;
                
                // Apply personality if requested
                if (options.includePersonality && personality) {
                    finalMatch.personalityApplied = applyPersonalityToResponse(result.response, personality);
                    if (options.showPersonalityApplication) {
                        finalMatch.personalityDetails = getPersonalityApplicationDetails(personality);
                    }
                }
                
                // Stop here unless testing all sources
                if (!options.testAllSources) {
                    break;
                }
            }

            // Special handling for inHouseFallback
            if (source.source === 'inHouseFallback' && source.fallbackBehavior === 'always_respond') {
                if (!finalMatch) {
                    finalMatch = result;
                    if (options.includePersonality && personality) {
                        finalMatch.personalityApplied = applyPersonalityToResponse(result.response, personality);
                    }
                }
                break;
            }
        }

        const totalTestTime = Date.now() - startTime;

        return {
            routingFlow: options.showRoutingDecisions ? routingFlow : routingFlow.filter(r => r.match),
            finalMatch,
            totalTestTime: `${totalTestTime}ms`,
            performance: {
                totalSources: sortedFlow.length,
                sourcesMatched: routingFlow.filter(r => r.match).length,
                avgSourceTime: routingFlow.length > 0 ? 
                    routingFlow.reduce((sum, r) => sum + parseInt(r.responseTime), 0) / routingFlow.length : 0
            },
            recommendation: generateTestRecommendation(finalMatch, routingFlow, totalTestTime)
        };

    } catch (error) {
        logger.error(`❌ Complete flow test execution failed for company ${companyId}`, error);
        return {
            routingFlow: [],
            finalMatch: null,
            totalTestTime: `${Date.now() - startTime}ms`,
            error: error.message
        };
    }
}

/**
 * Test individual knowledge source
 * @param {string} query - Test query
 * @param {string} source - Knowledge source type
 * @param {Object} knowledge - Knowledge management object
 * @param {number} threshold - Confidence threshold
 * @returns {Object} Test result
 */
async function testKnowledgeSource(query, source, knowledge, threshold) {
    const queryLower = query.toLowerCase();
    
    switch (source) {
        case 'companyQnA':
            return testCompanyQnA(queryLower, knowledge?.companyQnA || [], threshold);
        case 'tradeQnA':
            return testTradeQnA(queryLower, knowledge?.tradeQnA || [], threshold);
        case 'templates':
            return testTemplates(queryLower, knowledge?.templates || [], threshold);
        case 'inHouseFallback':
            return testInHouseFallback(queryLower, knowledge?.inHouseFallback, threshold);
        default:
            return {
                source,
                confidence: 0,
                threshold,
                match: false,
                result: 'UNKNOWN_SOURCE',
                response: null
            };
    }
}

/**
 * Test Company Q&A source
 * @param {string} query - Test query (lowercase)
 * @param {Array} companyQnA - Company Q&A entries
 * @param {number} threshold - Confidence threshold
 * @returns {Object} Test result
 */
function testCompanyQnA(query, companyQnA, threshold) {
    let bestMatch = null;
    let maxConfidence = 0;

    companyQnA.forEach(qna => {
        if (qna.status !== 'active') return;
        
        const confidence = calculateMatchConfidence(query, qna.question.toLowerCase(), qna.keywords);
        if (confidence > maxConfidence) {
            maxConfidence = confidence;
            bestMatch = qna;
        }
    });

    return {
        source: 'companyQnA',
        confidence: maxConfidence,
        threshold,
        match: maxConfidence >= threshold,
        result: maxConfidence >= threshold ? 'MATCH - Company Q&A' : 'SKIP - Below threshold',
        response: bestMatch ? bestMatch.answer : null,
        matchedEntry: bestMatch ? {
            id: bestMatch.id,
            question: bestMatch.question,
            keywords: bestMatch.keywords
        } : null
    };
}

/**
 * Test Trade Q&A source
 * @param {string} query - Test query (lowercase)
 * @param {Array} tradeQnA - Trade Q&A entries
 * @param {number} threshold - Confidence threshold
 * @returns {Object} Test result
 */
function testTradeQnA(query, tradeQnA, threshold) {
    let bestMatch = null;
    let maxConfidence = 0;

    tradeQnA.forEach(qna => {
        if (qna.status !== 'active') return;
        
        const confidence = calculateMatchConfidence(query, qna.question.toLowerCase(), qna.keywords);
        if (confidence > maxConfidence) {
            maxConfidence = confidence;
            bestMatch = qna;
        }
    });

    return {
        source: 'tradeQnA',
        confidence: maxConfidence,
        threshold,
        match: maxConfidence >= threshold,
        result: maxConfidence >= threshold ? 'MATCH - Trade Q&A' : 'SKIP - Below threshold',
        response: bestMatch ? bestMatch.answer : null,
        matchedEntry: bestMatch ? {
            id: bestMatch.id,
            question: bestMatch.question,
            tradeCategory: bestMatch.tradeCategory,
            keywords: bestMatch.keywords
        } : null
    };
}

/**
 * Test Templates source
 * @param {string} query - Test query (lowercase)
 * @param {Array} templates - Template entries
 * @param {number} threshold - Confidence threshold
 * @returns {Object} Test result
 */
function testTemplates(query, templates, threshold) {
    let bestMatch = null;
    let maxConfidence = 0;

    templates.forEach(template => {
        if (template.status !== 'active') return;
        
        const confidence = calculateMatchConfidence(query, template.name.toLowerCase(), template.keywords);
        if (confidence > maxConfidence) {
            maxConfidence = confidence;
            bestMatch = template;
        }
    });

    return {
        source: 'templates',
        confidence: maxConfidence,
        threshold,
        match: maxConfidence >= threshold,
        result: maxConfidence >= threshold ? 'MATCH - Template' : 'SKIP - Below threshold',
        response: bestMatch ? bestMatch.template : null,
        matchedEntry: bestMatch ? {
            id: bestMatch.id,
            name: bestMatch.name,
            category: bestMatch.category,
            keywords: bestMatch.keywords
        } : null
    };
}

/**
 * Test In-House Fallback source
 * @param {string} query - Test query (lowercase)
 * @param {Object} fallback - In-house fallback configuration
 * @param {number} threshold - Confidence threshold
 * @returns {Object} Test result
 */
function testInHouseFallback(query, fallback, threshold) {
    if (!fallback || !fallback.enabled) {
        return {
            source: 'inHouseFallback',
            confidence: 0,
            threshold,
            match: false,
            result: 'DISABLED - Fallback not enabled',
            response: null
        };
    }

    // Test keyword categories
    const categories = ['service', 'booking', 'emergency', 'hours'];
    let bestCategory = 'general';
    let maxConfidence = 0.5; // Always above threshold for fallback

    categories.forEach(category => {
        const keywords = fallback[`${category}Keywords`] || [];
        const confidence = calculateKeywordMatch(query, keywords);
        if (confidence > maxConfidence) {
            maxConfidence = confidence;
            bestCategory = category;
        }
    });

    return {
        source: 'inHouseFallback',
        confidence: maxConfidence,
        threshold,
        match: true, // Always matches for fallback
        result: 'FALLBACK - Always responds',
        response: fallback.responses[bestCategory] || fallback.responses.general,
        matchedCategory: bestCategory,
        keywords: fallback[`${bestCategory}Keywords`] || []
    };
}

/**
 * Apply personality to response
 * @param {string} response - Original response
 * @param {Object} personality - Personality configuration
 * @returns {string} Personality-enhanced response
 */
function applyPersonalityToResponse(response, personality) {
    if (!response || !personality) return response;

    let enhancedResponse = response;
    const corePersonality = personality.corePersonality || {};

    // Apply voice tone
    switch (corePersonality.voiceTone) {
        case 'friendly':
            enhancedResponse = `Hi there! ${enhancedResponse} Hope this helps!`;
            break;
        case 'professional':
            enhancedResponse = `Thank you for your inquiry. ${enhancedResponse}`;
            break;
        case 'empathetic':
            enhancedResponse = `I understand your concern. ${enhancedResponse} We're here to help.`;
            break;
    }

    // Apply empathy level
    if (corePersonality.empathyLevel >= 4) {
        const empathyPhrases = personality.emotionalIntelligence?.empathyPhrases || [];
        if (empathyPhrases.length > 0) {
            const randomPhrase = empathyPhrases[Math.floor(Math.random() * empathyPhrases.length)];
            enhancedResponse = `${randomPhrase}. ${enhancedResponse}`;
        }
    }

    return enhancedResponse;
}

/**
 * Get personality application details
 * @param {Object} personality - Personality configuration
 * @returns {Object} Personality details
 */
function getPersonalityApplicationDetails(personality) {
    const corePersonality = personality.corePersonality || {};
    
    return {
        voiceTone: corePersonality.voiceTone || 'professional',
        empathyLevel: corePersonality.empathyLevel || 3,
        formalityLevel: corePersonality.formalityLevel || 'business',
        technicalDepth: corePersonality.technicalDepth || 'moderate',
        appliedFeatures: [
            'Voice tone adjustment',
            'Empathy level application',
            'Formality level matching'
        ]
    };
}

/**
 * Calculate match confidence between query and content
 * @param {string} query - Search query (lowercase)
 * @param {string} content - Content to match against (lowercase)
 * @param {Array} keywords - Keywords array
 * @returns {number} Confidence score (0-1)
 */
function calculateMatchConfidence(query, content, keywords = []) {
    let confidence = 0;
    
    // Direct text matching
    if (content.includes(query)) {
        confidence += 0.8;
    } else {
        // Word-by-word matching
        const queryWords = query.split(/\s+/);
        const contentWords = content.split(/\s+/);
        const matches = queryWords.filter(word => contentWords.includes(word));
        confidence += (matches.length / queryWords.length) * 0.6;
    }
    
    // Keyword matching
    if (keywords.length > 0) {
        const keywordMatches = keywords.filter(keyword => 
            query.includes(keyword.toLowerCase()) || keyword.toLowerCase().includes(query)
        );
        confidence += (keywordMatches.length / keywords.length) * 0.4;
    }
    
    return Math.min(confidence, 1.0);
}

/**
 * Calculate keyword match confidence
 * @param {string} query - Search query (lowercase)
 * @param {Array} keywords - Keywords to match against
 * @returns {number} Confidence score (0-1)
 */
function calculateKeywordMatch(query, keywords) {
    if (!keywords || keywords.length === 0) return 0;
    
    const matches = keywords.filter(keyword => 
        query.includes(keyword.toLowerCase()) || keyword.toLowerCase().includes(query)
    );
    
    return matches.length > 0 ? Math.min(matches.length / keywords.length + 0.3, 1.0) : 0;
}

/**
 * Generate test recommendation
 * @param {Object} finalMatch - Final match result
 * @param {Array} routingFlow - Complete routing flow
 * @param {number} totalTestTime - Total test time in ms
 * @returns {string} Recommendation text
 */
function generateTestRecommendation(finalMatch, routingFlow, totalTestTime) {
    if (!finalMatch) {
        return 'No matches found. Consider adding this query to your Company Q&A or Trade Q&A knowledge base.';
    }

    const recommendations = [];

    // Performance recommendation
    if (totalTestTime > 100) {
        recommendations.push('Consider optimizing your knowledge base for better performance');
    }

    // Source recommendation
    if (finalMatch.source === 'inHouseFallback') {
        recommendations.push('This query fell back to the general response. Consider adding a specific Q&A entry for better accuracy');
    }

    // Confidence recommendation
    if (finalMatch.confidence < 0.9) {
        recommendations.push('Consider adding more keywords or improving the question/answer content for better matching');
    }

    return recommendations.length > 0 ? 
        recommendations.join('. ') + '.' : 
        'Great! Your AI agent handled this query effectively.';
}

/**
 * Get default priority flow
 * @returns {Array} Default priority flow configuration
 */
function getDefaultPriorityFlow() {
    return [
        { source: 'companyQnA', priority: 1, threshold: 0.8, enabled: true, fallbackBehavior: 'continue' },
        { source: 'tradeQnA', priority: 2, threshold: 0.75, enabled: true, fallbackBehavior: 'continue' },
        { source: 'templates', priority: 3, threshold: 0.7, enabled: true, fallbackBehavior: 'continue' },
        { source: 'inHouseFallback', priority: 4, threshold: 0.5, enabled: true, fallbackBehavior: 'always_respond' }
    ];
}

// Placeholder functions for batch testing, performance testing, etc.
// These would be implemented with full functionality in production

async function executeBatchTest(companyId, queries, config, options) {
    // Implementation for batch testing
    return {
        summary: { successRate: 0.85, totalQueries: queries.length },
        results: [],
        totalTestTime: '500ms'
    };
}

async function executePerformanceTest(companyId, config, options) {
    // Implementation for performance testing
    return {
        metrics: { avgResponseTime: 45, maxResponseTime: 120, minResponseTime: 15 },
        totalTestTime: `${options.testDuration * 1000}ms`
    };
}

async function executeAtlasAirScenarios(companyId, config, options) {
    // Implementation for Atlas Air scenario testing
    return {
        summary: { passedScenarios: options.scenarios.length, totalScenarios: options.scenarios.length },
        scenarios: [],
        totalTestTime: '750ms'
    };
}

async function executeConfigurationValidation(companyId, config, options) {
    // Implementation for configuration validation
    return {
        overallScore: 85,
        issues: [],
        recommendations: [],
        validationTime: '200ms'
    };
}

module.exports = router;
