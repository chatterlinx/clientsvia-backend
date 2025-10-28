// ============================================================================
// 🟢 PRODUCTION AI HEALTH MONITOR
// ============================================================================
// PURPOSE: Monitors Production AI system health and sends alerts
// FEATURES: 8-hour health pings, budget tracking, fallback rate monitoring
// ALERTS: Every error, fallback, budget warning, LLM status change
// DOCUMENTATION: /docs/PRODUCTION-AI-CORE-INTEGRATION.md
// ============================================================================

const logger = require('../utils/logger');
const Company = require('../models/v2Company');
const AdminNotificationService = require('./AdminNotificationService');
const DependencyHealthMonitor = require('./DependencyHealthMonitor');

// ============================================================================
// 🟢 PRODUCTION AI HEALTH MONITOR CLASS
// ============================================================================

class ProductionAIHealthMonitor {
    constructor() {
        this.healthCheckInterval = null;
        this.HEALTH_CHECK_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8 hours
        this.fallbackRateThreshold = 0.15; // 15%
        this.budgetWarningThreshold = 0.80; // 80%
        
        logger.info('[PRODUCTION AI HEALTH] Service initialized');
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🟢 START PERIODIC HEALTH CHECKS
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Starts periodic health checks (every 8 hours)
     */
    startPeriodicHealthChecks() {
        logger.info('[PRODUCTION AI HEALTH] Starting periodic health checks (every 8 hours)');
        
        // Run immediate check on startup
        setTimeout(() => {
            this.runFullHealthCheck().catch(err => {
                logger.error('[PRODUCTION AI HEALTH] Initial health check failed', { error: err.message });
            });
        }, 5000); // 5 second delay after startup
        
        // Schedule periodic checks
        this.healthCheckInterval = setInterval(async () => {
            try {
                await this.runFullHealthCheck();
            } catch (error) {
                logger.error('[PRODUCTION AI HEALTH] Periodic health check failed', {
                    error: error.message,
                    stack: error.stack
                });
            }
        }, this.HEALTH_CHECK_INTERVAL_MS);
        
        logger.info('[PRODUCTION AI HEALTH] Periodic health checks started');
    }

    /**
     * Stops periodic health checks
     */
    stopPeriodicHealthChecks() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
            logger.info('[PRODUCTION AI HEALTH] Stopped periodic health checks');
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🔍 RUN FULL HEALTH CHECK
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Runs comprehensive health check of all Production AI components
     */
    async runFullHealthCheck() {
        logger.info('[PRODUCTION AI HEALTH] ═══════════════════════════════════════════');
        logger.info('[PRODUCTION AI HEALTH] Running full system health check...');
        logger.info('[PRODUCTION AI HEALTH] ═══════════════════════════════════════════');
        
        const healthReport = {
            timestamp: new Date(),
            llm: null,
            database: null,
            cache: null,
            companies: []
        };

        try {
            // ─────────────────────────────────────────────────────────────────
            // CHECK 1: LLM CONNECTION (CRITICAL)
            // ─────────────────────────────────────────────────────────────────
            logger.info('[PRODUCTION AI HEALTH] CHECK 1/4: LLM Connection');
            
            const depHealthMonitor = DependencyHealthMonitor.getInstance();
            const llmHealth = await depHealthMonitor.checkOpenAI();
            
            healthReport.llm = llmHealth;
            
            if (llmHealth.status === 'HEALTHY') {
                // 🟢 GREEN: LLM is operational
                await AdminNotificationService.sendAlert({
                    code: 'PRODUCTION_AI_LLM_HEALTHY',
                    severity: 'INFO',
                    title: '🟢 Production AI: LLM Connection Healthy',
                    message: `OpenAI API is operational. Response time: ${llmHealth.responseTime}ms. Tier 3 fallback is ready for production use.`,
                    details: {
                        model: llmHealth.model,
                        responseTime: llmHealth.responseTime,
                        lastChecked: new Date(),
                        checkType: 'Periodic (8-hour)'
                    }
                });
            } else if (llmHealth.status === 'SLOW') {
                // 🟡 YELLOW: LLM is slow
                await AdminNotificationService.sendAlert({
                    code: 'PRODUCTION_AI_LLM_SLOW',
                    severity: 'WARNING',
                    title: '🟡 Production AI: LLM Response Slow',
                    message: `OpenAI API is responding slowly (${llmHealth.responseTime}ms). This may impact customer experience for Tier 3 queries.`,
                    details: {
                        responseTime: llmHealth.responseTime,
                        threshold: '3000ms',
                        recommendation: 'Monitor performance. Consider temporary budget limits if degradation continues.'
                    }
                });
            } else if (llmHealth.status === 'NOT_CONFIGURED') {
                // ℹ️ INFO: LLM not configured
                logger.info('[PRODUCTION AI HEALTH] LLM not configured (expected if feature disabled)');
            } else {
                // 🔴 RED: LLM is down
                await AdminNotificationService.sendAlert({
                    code: 'PRODUCTION_AI_LLM_DOWN',
                    severity: 'CRITICAL',
                    title: '🔴 Production AI: LLM CONNECTION LOST',
                    message: `CRITICAL: OpenAI API is unreachable! Tier 3 fallback is DISABLED. All queries will use Tier 1/2 or fallback responses only.`,
                    details: {
                        error: llmHealth.error,
                        lastSuccessfulCheck: llmHealth.lastSuccessful,
                        impact: 'HIGH - Customers with complex questions will receive generic fallback responses',
                        action: 'IMMEDIATE - Check OpenAI API status and credentials'
                    }
                });
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 2: DATABASE CONNECTION
            // ─────────────────────────────────────────────────────────────────
            logger.info('[PRODUCTION AI HEALTH] CHECK 2/4: Database Connection');
            
            const dbHealth = await depHealthMonitor.checkMongoDB();
            healthReport.database = dbHealth;
            
            if (dbHealth.status !== 'HEALTHY') {
                await AdminNotificationService.sendAlert({
                    code: 'PRODUCTION_AI_DATABASE_ERROR',
                    severity: 'CRITICAL',
                    title: '🔴 Production AI: Database Connection Error',
                    message: 'MongoDB connection issue detected. AI Core cannot load company settings.',
                    details: dbHealth
                });
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 3: REDIS CACHE
            // ─────────────────────────────────────────────────────────────────
            logger.info('[PRODUCTION AI HEALTH] CHECK 3/4: Redis Cache');
            
            const cacheHealth = await depHealthMonitor.checkRedis();
            healthReport.cache = cacheHealth;
            
            if (cacheHealth.status !== 'HEALTHY') {
                await AdminNotificationService.sendAlert({
                    code: 'PRODUCTION_AI_CACHE_ERROR',
                    severity: 'WARNING',
                    title: '🟡 Production AI: Redis Cache Unavailable',
                    message: 'Redis is down. Performance will be degraded (no caching).',
                    details: cacheHealth
                });
            }

            // ─────────────────────────────────────────────────────────────────
            // CHECK 4: COMPANY-LEVEL HEALTH (Budget & Fallback Rate)
            // ─────────────────────────────────────────────────────────────────
            logger.info('[PRODUCTION AI HEALTH] CHECK 4/4: Company-Level Health');
            
            await this.checkCompanyHealthMetrics();

            logger.info('[PRODUCTION AI HEALTH] ═══════════════════════════════════════════');
            logger.info('[PRODUCTION AI HEALTH] Health check complete!');
            logger.info('[PRODUCTION AI HEALTH] ═══════════════════════════════════════════');
            
            return healthReport;
            
        } catch (error) {
            logger.error('[PRODUCTION AI HEALTH] Health check failed', {
                error: error.message,
                stack: error.stack
            });
            
            await AdminNotificationService.sendAlert({
                code: 'PRODUCTION_AI_HEALTH_CHECK_FAILED',
                severity: 'CRITICAL',
                title: '🔴 Production AI: Health Check System Failure',
                message: 'The health monitoring system itself has encountered an error.',
                details: {
                    error: error.message,
                    stack: error.stack
                }
            });
            
            throw error;
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 📊 CHECK COMPANY-LEVEL METRICS
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Checks budget usage and fallback rates for all companies with gatekeeper enabled
     */
    async checkCompanyHealthMetrics() {
        try {
            const companies = await Company.find({
                'aiAgentLogic.templateGatekeeper.enabled': true
            }).select('companyName aiAgentLogic');

            logger.info('[PRODUCTION AI HEALTH] Checking health for companies', {
                count: companies.length
            });

            for (const company of companies) {
                const gatekeeper = company.aiAgentLogic.templateGatekeeper;
                
                // ─────────────────────────────────────────────────────────────
                // METRIC 1: Budget Usage
                // ─────────────────────────────────────────────────────────────
                if (gatekeeper.monthlyBudget && gatekeeper.currentSpend !== undefined) {
                    const budgetUsage = gatekeeper.currentSpend / gatekeeper.monthlyBudget;
                    
                    if (budgetUsage >= 1.0) {
                        // 🔴 RED: Budget exceeded
                        await AdminNotificationService.sendAlert({
                            code: 'PRODUCTION_AI_BUDGET_EXCEEDED',
                            severity: 'CRITICAL',
                            companyId: company._id.toString(),
                            title: `🔴 ${company.companyName}: LLM Budget EXCEEDED`,
                            message: `Company has exceeded their monthly LLM budget ($${gatekeeper.monthlyBudget}). Tier 3 is now DISABLED until budget reset.`,
                            details: {
                                companyName: company.companyName,
                                budgetLimit: gatekeeper.monthlyBudget,
                                currentSpend: gatekeeper.currentSpend,
                                overage: gatekeeper.currentSpend - gatekeeper.monthlyBudget,
                                action: 'Tier 3 LLM fallback automatically disabled. Increase budget or wait for monthly reset.'
                            }
                        });
                    } else if (budgetUsage >= this.budgetWarningThreshold) {
                        // 🟡 YELLOW: 80% budget used
                        await AdminNotificationService.sendAlert({
                            code: 'PRODUCTION_AI_BUDGET_80',
                            severity: 'WARNING',
                            companyId: company._id.toString(),
                            title: `🟡 ${company.companyName}: LLM Budget 80% Used`,
                            message: `Company has used ${(budgetUsage * 100).toFixed(0)}% of their monthly LLM budget.`,
                            details: {
                                companyName: company.companyName,
                                budgetLimit: gatekeeper.monthlyBudget,
                                currentSpend: gatekeeper.currentSpend,
                                remaining: gatekeeper.monthlyBudget - gatekeeper.currentSpend,
                                recommendation: 'Monitor usage. Consider increasing budget if approaching limit.'
                            }
                        });
                    }
                }

                // ─────────────────────────────────────────────────────────────
                // METRIC 2: Fallback Rate (calculated from recent call logs)
                // ─────────────────────────────────────────────────────────────
                const fallbackRate = await this.calculateFallbackRate(company._id);
                
                if (fallbackRate >= this.fallbackRateThreshold) {
                    // 🟡 YELLOW: High fallback rate (>15%)
                    await AdminNotificationService.sendAlert({
                        code: 'PRODUCTION_AI_FALLBACK_RATE_HIGH',
                        severity: 'WARNING',
                        companyId: company._id.toString(),
                        title: `🟡 ${company.companyName}: High Fallback Rate Detected`,
                        message: `${(fallbackRate * 100).toFixed(0)}% of calls are using fallback responses (AI unable to match query). This indicates missing scenarios or unclear customer questions.`,
                        details: {
                            companyName: company.companyName,
                            fallbackRate: `${(fallbackRate * 100).toFixed(0)}%`,
                            threshold: '15%',
                            recommendation: 'Review call logs to identify common questions that need new scenarios. Use AI Suggestions in Global AI Brain.'
                        }
                    });
                }
            }
            
        } catch (error) {
            logger.error('[PRODUCTION AI HEALTH] Error checking company metrics', {
                error: error.message,
                stack: error.stack
            });
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 📈 CALCULATE FALLBACK RATE FOR COMPANY (last 24 hours)
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Calculates fallback usage rate for a company over the last 24 hours
     */
    async calculateFallbackRate(companyId) {
        try {
            const v2AIAgentCallLog = require('../models/v2AIAgentCallLog');
            
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
            
            const totalCalls = await v2AIAgentCallLog.countDocuments({
                companyID: companyId,
                createdAt: { $gte: yesterday }
            });
            
            if (totalCalls === 0) return 0;
            
            const fallbackCalls = await v2AIAgentCallLog.countDocuments({
                companyID: companyId,
                createdAt: { $gte: yesterday },
                finalMatchedSource: 'fallback' // Assuming we tag fallback responses
            });
            
            return fallbackCalls / totalCalls;
            
        } catch (error) {
            logger.error('[PRODUCTION AI HEALTH] Error calculating fallback rate', {
                companyId,
                error: error.message
            });
            
            return 0;
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🔔 TRACK FALLBACK USAGE (Called by IntelligentFallbackService)
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Sends notification for EVERY fallback usage
     */
    async trackFallbackUsage(companyId, fallbackType, context) {
        try {
            await AdminNotificationService.sendAlert({
                code: 'PRODUCTION_AI_FALLBACK_USED',
                severity: 'WARNING',
                companyId: companyId.toString(),
                title: '⚠️ Production AI: Fallback Response Used',
                message: `AI was unable to match a customer query and used a fallback response. This indicates a potential gap in scenario coverage.`,
                details: {
                    companyName: context.companyName || 'Unknown',
                    fallbackType,
                    customerQuery: context.query?.substring(0, 200) || 'Query not available',
                    confidence: context.confidence,
                    attemptedTiers: context.attemptedTiers,
                    recommendation: 'Review this query to determine if a new scenario should be added.'
                }
            });
            
            logger.warn('[PRODUCTION AI] Fallback used', {
                companyId,
                fallbackType,
                query: context.query?.substring(0, 100)
            });
            
        } catch (error) {
            logger.error('[PRODUCTION AI] Failed to track fallback usage', {
                error: error.message
            });
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🚨 TRACK ROUTING ERRORS (Called by TemplateGatekeeper on errors)
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Sends critical alert for routing errors
     */
    async trackRoutingError(companyId, error, context) {
        try {
            await AdminNotificationService.sendAlert({
                code: 'PRODUCTION_AI_ROUTING_ERROR',
                severity: 'CRITICAL',
                companyId: companyId?.toString(),
                title: '🔴 Production AI: Routing Error',
                message: `A critical error occurred while routing a customer query. Customer may have received an error message or dead air.`,
                details: {
                    companyName: context.companyName || 'Unknown',
                    error: error.message,
                    stack: error.stack,
                    customerQuery: context.query?.substring(0, 200) || 'Query not available',
                    routingStage: context.stage,
                    action: 'IMMEDIATE - Check error logs and fix routing logic'
                },
                trace: error.stack
            });
            
            logger.error('[PRODUCTION AI] Routing error', {
                companyId,
                error: error.message,
                context
            });
            
        } catch (notifError) {
            logger.error('[PRODUCTION AI] Failed to send routing error notification', {
                error: notifError.message
            });
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 💰 TRACK BUDGET EXCEEDED
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Sends critical alert when budget is exceeded
     */
    async trackBudgetExceeded(companyId, companyName, gatekeeperConfig) {
        try {
            await AdminNotificationService.sendAlert({
                code: 'PRODUCTION_AI_BUDGET_EXCEEDED',
                severity: 'CRITICAL',
                companyId: companyId.toString(),
                title: `🔴 ${companyName}: LLM Budget EXCEEDED`,
                message: `Company has exceeded their monthly LLM budget ($${gatekeeperConfig.monthlyBudget}). Tier 3 is now DISABLED until budget reset.`,
                details: {
                    companyName,
                    budgetLimit: gatekeeperConfig.monthlyBudget,
                    currentSpend: gatekeeperConfig.currentSpend,
                    overage: gatekeeperConfig.currentSpend - gatekeeperConfig.monthlyBudget,
                    lastResetDate: gatekeeperConfig.lastResetDate,
                    action: 'Tier 3 LLM fallback automatically disabled. Increase budget or wait for monthly reset.'
                }
            });
            
            logger.error('[PRODUCTION AI] Budget exceeded', {
                companyId,
                companyName,
                budget: gatekeeperConfig.monthlyBudget,
                spent: gatekeeperConfig.currentSpend
            });
            
        } catch (error) {
            logger.error('[PRODUCTION AI] Failed to send budget exceeded notification', {
                error: error.message
            });
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // ⚠️ TRACK BUDGET WARNING (80% threshold)
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Sends warning when budget usage reaches 80%
     */
    async trackBudgetWarning(companyId, companyName, gatekeeperConfig, newSpend, budgetUsage) {
        try {
            await AdminNotificationService.sendAlert({
                code: 'PRODUCTION_AI_BUDGET_80',
                severity: 'WARNING',
                companyId: companyId.toString(),
                title: `🟡 ${companyName}: LLM Budget 80% Used`,
                message: `Company has used ${(budgetUsage * 100).toFixed(0)}% of their monthly LLM budget.`,
                details: {
                    companyName,
                    budgetLimit: gatekeeperConfig.monthlyBudget,
                    currentSpend: newSpend,
                    remaining: gatekeeperConfig.monthlyBudget - newSpend,
                    usagePercentage: `${(budgetUsage * 100).toFixed(0)}%`,
                    recommendation: 'Monitor usage. Consider increasing budget if approaching limit.'
                }
            });
            
            logger.warn('[PRODUCTION AI] Budget warning (80%)', {
                companyId,
                companyName,
                usage: `${(budgetUsage * 100).toFixed(0)}%`
            });
            
        } catch (error) {
            logger.error('[PRODUCTION AI] Failed to send budget warning notification', {
                error: error.message
            });
        }
    }
}

// ============================================================================
// 🚀 EXPORT SINGLETON INSTANCE
// ============================================================================

module.exports = new ProductionAIHealthMonitor();

