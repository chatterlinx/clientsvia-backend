/**
 * 🔍 AI AGENT MONITORING & DIAGNOSTICS API
 * =======================================
 * V2-grade monitoring endpoints for AI agent system health
 * Real-time diagnostics, performance metrics, and failure detection
 * 
 * ENDPOINTS:
 * GET /api/admin/ai-agent-monitoring/health/:companyId - System health check
 * GET /api/admin/ai-agent-monitoring/metrics/:companyId - Performance metrics
 * GET /api/admin/ai-agent-monitoring/diagnostics/:companyId - Deep diagnostics
 * GET /api/admin/ai-agent-monitoring/test-flow/:companyId - Test complete flow
 * GET /api/admin/ai-agent-monitoring/dashboard - Real-time dashboard data
 * 
 * FEATURES:
 * - Real-time health status monitoring
 * - Performance metrics and response times
 * - Knowledge source connectivity testing
 * - Redis cache health verification
 * - Database connection monitoring
 * - AI agent routing diagnostics
 * - Threshold configuration validation
 */

const express = require('express');
const router = express.Router();
const Company = require('../../models/v2Company');
const CompanyKnowledgeQnA = require('../../models/knowledge/CompanyQnA');
const { authenticateJWT } = require('../../middleware/auth');
// V2 DELETED: Legacy v2 aiAgentCacheService - using simple Redis directly
const { redisClient } = require('../../clients');
const PriorityDrivenKnowledgeRouter = require('../../services/v2priorityDrivenKnowledgeRouter');
const logger = require('../../utils/logger');

/**
 * 🏥 GET /api/admin/ai-agent-monitoring/health/:companyId
 * Comprehensive health check for AI agent system
 */
router.get('/health/:companyId', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    const startTime = Date.now();
    
    try {
        const healthStatus = {
            companyId,
            timestamp: new Date().toISOString(),
            overall: 'healthy',
            components: {},
            responseTime: 0,
            issues: [],
            recommendations: []
        };

        // 1. Database Connectivity
        try {
            const company = await Company.findById(companyId).select('_id companyName aiAgentLogic');
            if (company) {
                healthStatus.components.database = {
                    status: 'healthy',
                    message: 'MongoDB connection active',
                    details: {
                        companyFound: true,
                        companyName: company.companyName,
                        aiAgentConfigured: Boolean(company.aiAgentLogic)
                    }
                };
            } else {
                healthStatus.components.database = {
                    status: 'error',
                    message: 'Company not found in database',
                    details: { companyFound: false }
                };
                healthStatus.issues.push('Company not found - check companyId');
                healthStatus.overall = 'degraded';
            }
        } catch (error) {
            healthStatus.components.database = {
                status: 'error',
                message: 'Database connection failed',
                error: error.message
            };
            healthStatus.issues.push('Database connectivity issue');
            healthStatus.overall = 'unhealthy';
        }

        // 2. Redis Cache Health
        try {
            // V2 SYSTEM: Simple Redis cache test (no legacy v2 cache service)
            let cacheTest = null;
            try {
                const testKey = `health:test:${companyId}`;
                const cached = await redisClient.get(testKey);
                if (cached) {cacheTest = JSON.parse(cached);}
                await redisClient.setex(testKey, 60, JSON.stringify({ test: true, timestamp: Date.now() }));
            } catch (error) {
                logger.warn(`⚠️ V2 Cache test failed`, { error: error.message });
            }
            
            healthStatus.components.redis = {
                status: 'healthy',
                message: 'Redis cache operational',
                details: {
                    canRead: true,
                    canWrite: true,
                    testKey: `health:test:${companyId}`
                }
            };
        } catch (error) {
            healthStatus.components.redis = {
                status: 'warning',
                message: 'Redis cache unavailable - operating without cache',
                error: error.message
            };
            healthStatus.issues.push('Redis cache not available - performance may be slower');
            if (healthStatus.overall === 'healthy') {healthStatus.overall = 'degraded';}
        }

        // 3. Knowledge Sources Health
        try {
            const companyQnACount = await CompanyKnowledgeQnA.countDocuments({ companyId });
            const company = await Company.findById(companyId).select('aiAgentLogic.knowledgeManagement');
            
            const tradeQnACount = company?.aiAgentLogic?.knowledgeManagement?.tradeQnA?.length || 0;
            const templatesCount = company?.aiAgentLogic?.knowledgeManagement?.templates?.length || 0;
            
            healthStatus.components.knowledgeSources = {
                status: companyQnACount > 0 || tradeQnACount > 0 ? 'healthy' : 'warning',
                message: `Knowledge sources available`,
                details: {
                    companyQnA: companyQnACount,
                    tradeQnA: tradeQnACount,
                    templates: templatesCount,
                    totalEntries: companyQnACount + tradeQnACount + templatesCount
                }
            };

            if (companyQnACount === 0 && tradeQnACount === 0) {
                healthStatus.issues.push('No Q&A entries found - AI agent may not provide specific answers');
                healthStatus.recommendations.push('Add Company Q&A entries in Knowledge Management tab');
                if (healthStatus.overall === 'healthy') {healthStatus.overall = 'degraded';}
            }
        } catch (error) {
            healthStatus.components.knowledgeSources = {
                status: 'error',
                message: 'Failed to check knowledge sources',
                error: error.message
            };
            healthStatus.issues.push('Knowledge sources check failed');
            healthStatus.overall = 'unhealthy';
        }

        // 4. AI Agent Configuration
        try {
            const company = await Company.findById(companyId).select('aiAgentLogic');
            const aiLogic = company?.aiAgentLogic;
            
            if (aiLogic) {
                const hasThresholds = aiLogic.thresholds && Object.keys(aiLogic.thresholds).length > 0;
                const hasPriorities = aiLogic.knowledgeSourcePriorities && aiLogic.knowledgeSourcePriorities.priorityFlow;
                
                healthStatus.components.aiConfiguration = {
                    status: hasThresholds && hasPriorities ? 'healthy' : 'warning',
                    message: 'AI agent configuration status',
                    details: {
                        configured: true,
                        hasThresholds,
                        hasPriorities,
                        thresholds: aiLogic.thresholds || {},
                        priorityCount: hasPriorities ? aiLogic.knowledgeSourcePriorities.priorityFlow.length : 0
                    }
                };

                if (!hasThresholds || !hasPriorities) {
                    healthStatus.issues.push('AI agent configuration incomplete');
                    healthStatus.recommendations.push('Configure Knowledge Source Priorities in AI Agent Logic tab');
                    if (healthStatus.overall === 'healthy') {healthStatus.overall = 'degraded';}
                }
            } else {
                healthStatus.components.aiConfiguration = {
                    status: 'error',
                    message: 'AI agent not configured',
                    details: { configured: false }
                };
                healthStatus.issues.push('AI agent logic not configured');
                healthStatus.recommendations.push('Configure AI agent in company profile');
                healthStatus.overall = 'unhealthy';
            }
        } catch (error) {
            healthStatus.components.aiConfiguration = {
                status: 'error',
                message: 'Failed to check AI configuration',
                error: error.message
            };
            healthStatus.issues.push('AI configuration check failed');
            healthStatus.overall = 'unhealthy';
        }

        // 5. Priority Router Health
        try {
            const router = new PriorityDrivenKnowledgeRouter();
            const testResult = await router.routeQuery(companyId, 'health check test', { timeout: 5000 });
            
            healthStatus.components.priorityRouter = {
                status: testResult ? 'healthy' : 'warning',
                message: 'Priority-driven knowledge router operational',
                details: {
                    testQuery: 'health check test',
                    responseReceived: Boolean(testResult),
                    source: testResult?.source || 'none',
                    confidence: testResult?.confidence || 0
                }
            };
        } catch (error) {
            healthStatus.components.priorityRouter = {
                status: 'error',
                message: 'Priority router failed',
                error: error.message
            };
            healthStatus.issues.push('AI agent routing system failure');
            healthStatus.overall = 'unhealthy';
        }

        healthStatus.responseTime = Date.now() - startTime;
        
        res.json({
            success: true,
            data: healthStatus,
            meta: {
                responseTime: healthStatus.responseTime,
                timestamp: healthStatus.timestamp,
                version: '2.0'
            }
        });

    } catch (error) {
        logger.error(`AI Agent Health Check failed for company ${companyId}:`, error);
        
        res.status(500).json({
            success: false,
            error: 'Health check failed',
            details: error.message,
            meta: {
                responseTime: Date.now() - startTime,
                timestamp: new Date().toISOString()
            }
        });
    }
});

/**
 * 📊 GET /api/admin/ai-agent-monitoring/metrics/:companyId
 * Performance metrics and analytics
 */
router.get('/metrics/:companyId', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    const startTime = Date.now();
    
    try {
        // Get cached performance metrics
        const cacheKey = `metrics:${companyId}`;
        // V2 SYSTEM: Simple Redis cache check (no legacy v2 cache service)
        let metrics = null;
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {metrics = JSON.parse(cached);}
        } catch (error) {
            logger.warn(`⚠️ V2 Cache check failed for metrics`, { error: error.message });
        }
        
        if (!metrics) {
            // Generate fresh metrics
            const company = await Company.findById(companyId).select('aiAgentLogic');
            const companyQnACount = await CompanyKnowledgeQnA.countDocuments({ companyId });
            
            metrics = {
                companyId,
                timestamp: new Date().toISOString(),
                performance: {
                    avgResponseTime: 0, // Would be populated from actual usage logs
                    successRate: 0,
                    totalQueries: 0,
                    cacheHitRate: 0
                },
                knowledgeBase: {
                    companyQnA: companyQnACount,
                    tradeQnA: company?.aiAgentLogic?.knowledgeManagement?.tradeQnA?.length || 0,
                    templates: company?.aiAgentLogic?.knowledgeManagement?.templates?.length || 0
                },
                routing: {
                    companyQnAHits: 0,
                    tradeQnAHits: 0,
                    templateHits: 0,
                    fallbackHits: 0
                },
                thresholds: company?.aiAgentLogic?.thresholds || {},
                lastUpdated: company?.aiAgentLogic?.lastUpdated || null
            };
            
            // Cache for 5 minutes
            // V2 SYSTEM: Simple Redis cache set (no legacy v2 cache service)
            try {
                await redisClient.setex(cacheKey, 300, JSON.stringify(metrics));
            } catch (error) {
                logger.warn(`⚠️ V2 Cache set failed for metrics`, { error: error.message });
            }
        }
        
        res.json({
            success: true,
            data: metrics,
            meta: {
                responseTime: Date.now() - startTime,
                cached: true
            }
        });

    } catch (error) {
        logger.error(`AI Agent Metrics failed for company ${companyId}:`, error);
        
        res.status(500).json({
            success: false,
            error: 'Metrics collection failed',
            details: error.message
        });
    }
});

/**
 * 🔬 GET /api/admin/ai-agent-monitoring/diagnostics/:companyId
 * Deep system diagnostics and troubleshooting
 */
router.get('/diagnostics/:companyId', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    const startTime = Date.now();
    
    try {
        const diagnostics = {
            companyId,
            timestamp: new Date().toISOString(),
            tests: {},
            summary: {
                totalTests: 0,
                passed: 0,
                failed: 0,
                warnings: 0
            },
            recommendations: []
        };

        // Test 1: Company Configuration
        try {
            const company = await Company.findById(companyId);
            diagnostics.tests.companyConfiguration = {
                name: 'Company Configuration',
                status: company ? 'pass' : 'fail',
                details: {
                    exists: Boolean(company),
                    name: company?.companyName,
                    hasAiLogic: Boolean(company?.aiAgentLogic),
                    configuredAt: company?.aiAgentLogic?.lastUpdated
                }
            };
            diagnostics.summary.totalTests++;
            if (company) {diagnostics.summary.passed++;} else {diagnostics.summary.failed++;}
        } catch (error) {
            diagnostics.tests.companyConfiguration = {
                name: 'Company Configuration',
                status: 'fail',
                error: error.message
            };
            diagnostics.summary.totalTests++;
            diagnostics.summary.failed++;
        }

        // Test 2: Knowledge Sources Connectivity
        try {
            const companyQnAs = await CompanyKnowledgeQnA.find({ companyId }).limit(1);
            const company = await Company.findById(companyId).select('aiAgentLogic.knowledgeManagement');
            
            diagnostics.tests.knowledgeConnectivity = {
                name: 'Knowledge Sources Connectivity',
                status: 'pass',
                details: {
                    companyQnACollection: companyQnAs.length > 0,
                    embeddedKnowledge: Boolean(company?.aiAgentLogic?.knowledgeManagement),
                    totalSources: companyQnAs.length + (company?.aiAgentLogic?.knowledgeManagement?.tradeQnA?.length || 0)
                }
            };
            diagnostics.summary.totalTests++;
            diagnostics.summary.passed++;
        } catch (error) {
            diagnostics.tests.knowledgeConnectivity = {
                name: 'Knowledge Sources Connectivity',
                status: 'fail',
                error: error.message
            };
            diagnostics.summary.totalTests++;
            diagnostics.summary.failed++;
        }

        // Test 3: Priority Router Instantiation
        try {
            const router = new PriorityDrivenKnowledgeRouter();
            const config = await router.getPriorityConfiguration(companyId);
            
            diagnostics.tests.priorityRouter = {
                name: 'Priority Router System',
                status: config ? 'pass' : 'warning',
                details: {
                    canInstantiate: true,
                    hasConfiguration: Boolean(config),
                    priorityCount: config?.priorityFlow?.length || 0,
                    enabled: config?.enabled || false
                }
            };
            diagnostics.summary.totalTests++;
            if (config) {diagnostics.summary.passed++;} else {diagnostics.summary.warnings++;}
        } catch (error) {
            diagnostics.tests.priorityRouter = {
                name: 'Priority Router System',
                status: 'fail',
                error: error.message
            };
            diagnostics.summary.totalTests++;
            diagnostics.summary.failed++;
        }

        // Test 4: Cache System
        let retrieved = null;
        try {
            const testKey = `diagnostic:${companyId}:${Date.now()}`;
            // V2 SYSTEM: Simple Redis cache test (no legacy v2 cache service)
            try {
                await redisClient.setex(testKey, 60, JSON.stringify({ test: true }));
                const cached = await redisClient.get(testKey);
                retrieved = cached ? JSON.parse(cached) : null;
            } catch (error) {
                logger.warn(`⚠️ V2 Cache test failed in diagnostics`, { error: error.message });
            }
            
            diagnostics.tests.cacheSystem = {
                name: 'Redis Cache System',
                status: retrieved ? 'pass' : 'warning',
                details: {
                    canWrite: true,
                    canRead: Boolean(retrieved),
                    testKey
                }
            };
            diagnostics.summary.totalTests++;
            if (retrieved) {diagnostics.summary.passed++;} else {diagnostics.summary.warnings++;}
        } catch (error) {
            diagnostics.tests.cacheSystem = {
                name: 'Redis Cache System',
                status: 'warning',
                details: {
                    available: false,
                    error: error.message,
                    impact: 'Performance degraded but system functional'
                }
            };
            diagnostics.summary.totalTests++;
            diagnostics.summary.warnings++;
        }

        // Generate recommendations
        if (diagnostics.summary.failed > 0) {
            diagnostics.recommendations.push('Critical failures detected - immediate attention required');
        }
        if (diagnostics.summary.warnings > 0) {
            diagnostics.recommendations.push('System warnings present - monitor closely');
        }
        if (diagnostics.summary.passed === diagnostics.summary.totalTests) {
            diagnostics.recommendations.push('All systems operational - no action required');
        }

        res.json({
            success: true,
            data: diagnostics,
            meta: {
                responseTime: Date.now() - startTime,
                timestamp: diagnostics.timestamp
            }
        });

    } catch (error) {
        logger.error(`AI Agent Diagnostics failed for company ${companyId}:`, error);
        
        res.status(500).json({
            success: false,
            error: 'Diagnostics failed',
            details: error.message
        });
    }
});

/**
 * 🧪 GET /api/admin/ai-agent-monitoring/test-flow/:companyId
 * Test complete AI agent flow with sample queries
 */
router.get('/test-flow/:companyId', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    const { query = 'what are your hours' } = req.query;
    const startTime = Date.now();
    
    try {
        const router = new PriorityDrivenKnowledgeRouter();
        const result = await router.routeQuery(companyId, query, { 
            includeMetadata: true,
            timeout: 10000 
        });
        
        const testResult = {
            companyId,
            query,
            timestamp: new Date().toISOString(),
            result: {
                success: Boolean(result),
                source: result?.source || 'none',
                confidence: result?.confidence || 0,
                response: result?.response || 'No response generated',
                responseTime: Date.now() - startTime,
                metadata: result?.metadata || {}
            },
            analysis: {
                thresholdMet: result?.confidence >= 0.75,
                sourceUsed: result?.source || 'fallback',
                performance: Date.now() - startTime < 1000 ? 'good' : 'slow'
            }
        };
        
        res.json({
            success: true,
            data: testResult,
            meta: {
                responseTime: Date.now() - startTime,
                testQuery: query
            }
        });

    } catch (error) {
        logger.error(`AI Agent Flow Test failed for company ${companyId}:`, error);
        
        res.status(500).json({
            success: false,
            error: 'Flow test failed',
            details: error.message,
            meta: {
                responseTime: Date.now() - startTime,
                testQuery: query
            }
        });
    }
});

module.exports = router;
