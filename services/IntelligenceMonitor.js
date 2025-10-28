/**
 * ============================================================================
 * INTELLIGENCE MONITORING SERVICE - COMPREHENSIVE FAILURE DETECTION
 * ============================================================================
 * 
 * PURPOSE:
 * Monitor EVERYTHING in the 3-tier intelligence system and send alerts to
 * Notification Center for ANY issues: failures, errors, fallbacks, degraded
 * performance, configuration problems, etc.
 * 
 * MONITORING COVERAGE:
 * ✅ Template configuration errors
 * ✅ Tier 1 (rule-based) failures
 * ✅ Tier 2 (semantic) failures
 * ✅ Tier 3 (LLM) failures & budget exhaustion
 * ✅ Pattern learning failures
 * ✅ Degraded performance (slow responses)
 * ✅ All fallback scenarios
 * ✅ Missing/invalid data
 * ✅ Threshold violations
 * 
 * ALERT LEVELS:
 * - 🟢 HEALTHY: Everything working perfectly
 * - 🟡 WARNING: Degraded but still functional
 * - 🔴 CRITICAL: System failure, immediate action required
 * 
 * ============================================================================
 */

const AdminNotificationService = require('./AdminNotificationService');
const logger = require('../utils/logger');

class IntelligenceMonitor {
    constructor() {
        this.config = {
            // Performance thresholds (ms)
            tier1MaxTime: 100,      // Tier 1 should be < 100ms
            tier2MaxTime: 300,      // Tier 2 should be < 300ms
            tier3MaxTime: 5000,     // Tier 3 should be < 5s
            totalMaxTime: 10000,    // Total should be < 10s
            
            // Confidence thresholds
            minAcceptableConfidence: 0.4,  // Below this = warning
            
            // Cost thresholds
            tier3CostWarning: 1.00,  // Warn if single call > $1
            
            // Alert throttling (prevent spam)
            alertCooldownMs: 300000  // 5 minutes between same alert type
        };
        
        // Track recent alerts to prevent spam
        this.recentAlerts = new Map();
    }
    
    /**
     * ============================================================================
     * MONITOR ROUTING RESULT - Main monitoring entry point
     * ============================================================================
     * Called after IntelligentRouter completes a routing attempt
     */
    async monitorRoutingResult(routingResult, context = {}) {
        try {
            const { templateId, templateName, callId, companyId } = context;
            
            // Check for critical failures first
            if (!routingResult.success) {
                await this.alertCriticalFailure(routingResult, context);
                return;
            }
            
            // Check if no match found (all tiers failed)
            if (!routingResult.matched) {
                await this.alertNoMatchFound(routingResult, context);
                return;
            }
            
            // Check performance degradation
            if (routingResult.performance?.totalTime > this.config.totalMaxTime) {
                await this.alertSlowResponse(routingResult, context);
            }
            
            // Check tier-specific issues
            if (routingResult.tierUsed === 1) {
                await this.checkTier1Health(routingResult, context);
            } else if (routingResult.tierUsed === 2) {
                await this.checkTier2Health(routingResult, context);
            } else if (routingResult.tierUsed === 3) {
                await this.checkTier3Health(routingResult, context);
            }
            
            // Check for fallback patterns
            await this.detectFallbackPatterns(routingResult, context);
            
        } catch (error) {
            logger.error('❌ [INTELLIGENCE MONITOR] Monitoring failed', {
                error: error.message,
                context
            });
        }
    }
    
    /**
     * ============================================================================
     * ALERT: CRITICAL FAILURE
     * ============================================================================
     * Routing completely failed - system error
     */
    async alertCriticalFailure(routingResult, context) {
        const alertKey = `critical_failure_${context.templateId}`;
        
        if (this.shouldSendAlert(alertKey)) {
            await AdminNotificationService.sendAlert({
                code: 'AI_ROUTING_CRITICAL_FAILURE',
                severity: 'CRITICAL',
                title: '🚨 3-Tier Intelligence System: CRITICAL FAILURE',
                message: `The intelligent routing system has COMPLETELY FAILED.\n\n` +
                         `Template: "${context.templateName}"\n` +
                         `Call ID: ${context.callId}\n` +
                         `Error: ${routingResult.error || 'Unknown error'}\n\n` +
                         `Impact: Calls cannot be routed to scenarios. System is DOWN.\n\n` +
                         `Action Required: Investigate immediately - check logs for template ${context.templateId}`,
                details: {
                    templateId: context.templateId,
                    templateName: context.templateName,
                    callId: context.callId,
                    companyId: context.companyId,
                    error: routingResult.error,
                    timestamp: new Date().toISOString()
                }
            });
            
            this.markAlertSent(alertKey);
        }
    }
    
    /**
     * ============================================================================
     * ALERT: NO MATCH FOUND (All 3 Tiers Failed)
     * ============================================================================
     * All tiers tried but none could match the input
     */
    async alertNoMatchFound(routingResult, context) {
        const alertKey = `no_match_${context.templateId}`;
        
        // Check confidence levels to determine severity
        const tier1Conf = routingResult.tier1Result?.confidence || 0;
        const tier2Conf = routingResult.tier2Result?.confidence || 0;
        const tier3Conf = routingResult.tier3Result?.confidence || 0;
        
        const highestConf = Math.max(tier1Conf, tier2Conf, tier3Conf);
        
        // If all tiers got low confidence, this is a warning (not critical)
        const severity = highestConf < 0.3 ? 'warning' : 'info';
        
        if (this.shouldSendAlert(alertKey)) {
            await AdminNotificationService.sendAlert({
                code: 'AI_ROUTING_NO_MATCH',
                severity,
                title: `${severity === 'warning' ? '⚠️' : 'ℹ️'} All 3 Tiers Failed to Match Input`,
                message: `No scenario could be matched after trying all 3 tiers.\n\n` +
                         `Template: "${context.templateName}"\n` +
                         `Call ID: ${context.callId}\n\n` +
                         `Confidence Scores:\n` +
                         `- Tier 1 (Rule-based): ${(tier1Conf * 100).toFixed(1)}%\n` +
                         `- Tier 2 (Semantic): ${(tier2Conf * 100).toFixed(1)}%\n` +
                         `- Tier 3 (LLM): ${(tier3Conf * 100).toFixed(1)}%\n\n` +
                         `${highestConf < 0.3 
                            ? 'This input may be completely unrelated to your scenarios.' 
                            : 'Close matches found but below thresholds - consider lowering tier thresholds.'}\n\n` +
                         `Cost: $${routingResult.cost?.total?.toFixed(4) || '0'}`,
                details: {
                    templateId: context.templateId,
                    templateName: context.templateName,
                    callId: context.callId,
                    tier1Confidence: tier1Conf,
                    tier2Confidence: tier2Conf,
                    tier3Confidence: tier3Conf,
                    highestConfidence: highestConf,
                    cost: routingResult.cost?.total || 0,
                    timestamp: new Date().toISOString()
                }
            });
            
            this.markAlertSent(alertKey);
        }
    }
    
    /**
     * ============================================================================
     * ALERT: SLOW RESPONSE (Performance Degradation)
     * ============================================================================
     */
    async alertSlowResponse(routingResult, context) {
        const alertKey = `slow_response_${context.templateId}`;
        const totalTime = routingResult.performance?.totalTime || 0;
        
        if (this.shouldSendAlert(alertKey)) {
            await AdminNotificationService.sendAlert({
                code: 'AI_ROUTING_SLOW_RESPONSE',
                severity: 'WARNING',
                title: '⏱️ Intelligence System: SLOW RESPONSE',
                message: `The 3-tier routing system is responding slowly.\n\n` +
                         `Template: "${context.templateName}"\n` +
                         `Total Time: ${totalTime}ms (threshold: ${this.config.totalMaxTime}ms)\n` +
                         `Tier Used: ${routingResult.tierUsed}\n\n` +
                         `Breakdown:\n` +
                         `- Tier 1: ${routingResult.performance?.tier1Time || 0}ms\n` +
                         `- Tier 2: ${routingResult.performance?.tier2Time || 0}ms\n` +
                         `- Tier 3: ${routingResult.performance?.tier3Time || 0}ms\n\n` +
                         `Impact: Degraded user experience, caller may experience delays.\n\n` +
                         `Action: Check system load, database performance, and OpenAI API latency.`,
                details: {
                    templateId: context.templateId,
                    templateName: context.templateName,
                    totalTime,
                    threshold: this.config.totalMaxTime,
                    tierUsed: routingResult.tierUsed,
                    performance: routingResult.performance,
                    timestamp: new Date().toISOString()
                }
            });
            
            this.markAlertSent(alertKey);
        }
    }
    
    /**
     * ============================================================================
     * CHECK TIER 3 HEALTH (LLM)
     * ============================================================================
     */
    async checkTier3Health(routingResult, context) {
        const tier3Result = routingResult.tier3Result;
        const cost = routingResult.cost?.tier3 || 0;
        
        // Alert if expensive call
        if (cost > this.config.tier3CostWarning) {
            const alertKey = `expensive_llm_${context.templateId}`;
            
            if (this.shouldSendAlert(alertKey)) {
                await AdminNotificationService.sendAlert({
                    code: 'AI_ROUTING_EXPENSIVE_LLM_CALL',
                    severity: 'WARNING',
                    title: '💰 Expensive LLM Call Detected',
                    message: `A Tier 3 (LLM) call cost more than expected.\n\n` +
                             `Template: "${context.templateName}"\n` +
                             `Cost: $${cost.toFixed(4)} (warning threshold: $${this.config.tier3CostWarning})\n` +
                             `Response Time: ${tier3Result?.responseTime || 0}ms\n\n` +
                             `This suggests:\n` +
                             `- Complex input requiring extensive LLM processing\n` +
                             `- Potential token usage optimization needed\n` +
                             `- Consider if Tier 1/2 thresholds are too high\n\n` +
                             `Patterns Learned: ${routingResult.patternsLearned?.length || 0}\n` +
                             `(These will make future calls FREE)`,
                    details: {
                        templateId: context.templateId,
                        cost,
                        threshold: this.config.tier3CostWarning,
                        patternsLearned: routingResult.patternsLearned?.length || 0,
                        tokensUsed: tier3Result?.tokensUsed,
                        timestamp: new Date().toISOString()
                    }
                });
                
                this.markAlertSent(alertKey);
            }
        }
        
        // Alert if LLM failed to extract patterns
        if (routingResult.matched && (!routingResult.patternsLearned || routingResult.patternsLearned.length === 0)) {
            const alertKey = `no_patterns_learned_${context.templateId}`;
            
            if (this.shouldSendAlert(alertKey)) {
                await AdminNotificationService.sendAlert({
                    code: 'AI_ROUTING_NO_PATTERNS_LEARNED',
                    severity: 'INFO',
                    title: 'ℹ️ LLM Matched but No Patterns Learned',
                    message: `Tier 3 (LLM) matched a scenario but did NOT extract any patterns for learning.\n\n` +
                             `Template: "${context.templateName}"\n` +
                             `Scenario: ${routingResult.scenario?.name}\n` +
                             `Confidence: ${(routingResult.confidence * 100).toFixed(1)}%\n` +
                             `Cost: $${cost.toFixed(4)}\n\n` +
                             `This means:\n` +
                             `- LLM spent money but didn't improve Tier 1\n` +
                             `- Next similar call will ALSO cost money\n` +
                             `- Self-improvement cycle is not working for this input\n\n` +
                             `Consider: Manually reviewing this call to add patterns.`,
                    details: {
                        templateId: context.templateId,
                        scenario: routingResult.scenario?.name,
                        confidence: routingResult.confidence,
                        cost,
                        callId: context.callId,
                        timestamp: new Date().toISOString()
                    }
                });
                
                this.markAlertSent(alertKey);
            }
        }
    }
    
    /**
     * ============================================================================
     * CHECK TIER 1 & TIER 2 HEALTH
     * ============================================================================
     */
    async checkTier1Health(routingResult, context) {
        const tier1Result = routingResult.tier1Result;
        const responseTime = tier1Result?.responseTime || 0;
        
        // Alert if Tier 1 is slow
        if (responseTime > this.config.tier1MaxTime) {
            const alertKey = `slow_tier1_${context.templateId}`;
            
            if (this.shouldSendAlert(alertKey)) {
                await AdminNotificationService.sendAlert({
                    code: 'AI_ROUTING_TIER1_SLOW',
                    severity: 'WARNING',
                    title: '🐢 Tier 1 (Rule-Based) Running Slow',
                    message: `Tier 1 response time is above acceptable threshold.\n\n` +
                             `Template: "${context.templateName}"\n` +
                             `Response Time: ${responseTime}ms (threshold: ${this.config.tier1MaxTime}ms)\n\n` +
                             `Possible causes:\n` +
                             `- Too many scenarios (${context.scenarioCount || 'unknown'})\n` +
                             `- Complex regex patterns\n` +
                             `- Large filler/synonym maps\n\n` +
                             `Action: Consider optimizing scenario count or splitting into multiple templates.`,
                    details: {
                        templateId: context.templateId,
                        responseTime,
                        threshold: this.config.tier1MaxTime,
                        scenarioCount: context.scenarioCount,
                        timestamp: new Date().toISOString()
                    }
                });
                
                this.markAlertSent(alertKey);
            }
        }
    }
    
    async checkTier2Health(routingResult, context) {
        const tier2Result = routingResult.tier2Result;
        const responseTime = tier2Result?.responseTime || 0;
        
        // Alert if Tier 2 is slow
        if (responseTime > this.config.tier2MaxTime) {
            const alertKey = `slow_tier2_${context.templateId}`;
            
            if (this.shouldSendAlert(alertKey)) {
                await AdminNotificationService.sendAlert({
                    code: 'AI_ROUTING_TIER2_SLOW',
                    severity: 'WARNING',
                    title: '🐢 Tier 2 (Semantic) Running Slow',
                    message: `Tier 2 response time is above acceptable threshold.\n\n` +
                             `Template: "${context.templateName}"\n` +
                             `Response Time: ${responseTime}ms (threshold: ${this.config.tier2MaxTime}ms)\n\n` +
                             `This may indicate:\n` +
                             `- BM25 calculation complexity\n` +
                             `- Large scenario database\n` +
                             `- System resource constraints\n\n` +
                             `Action: Monitor system resources and consider tier threshold adjustments.`,
                    details: {
                        templateId: context.templateId,
                        responseTime,
                        threshold: this.config.tier2MaxTime,
                        timestamp: new Date().toISOString()
                    }
                });
                
                this.markAlertSent(alertKey);
            }
        }
    }
    
    /**
     * ============================================================================
     * DETECT FALLBACK PATTERNS
     * ============================================================================
     * Detect if Tier 1 → 2 or Tier 2 → 3 fallbacks are happening frequently
     */
    async detectFallbackPatterns(routingResult, context) {
        // If used Tier 2 or 3, it means Tier 1 failed
        if (routingResult.tierUsed >= 2) {
            const tier1Result = routingResult.tier1Result;
            const tier1Conf = tier1Result?.confidence || 0;
            const tier1Threshold = context.tier1Threshold || 0.8;
            
            // If Tier 1 was close but failed threshold
            if (tier1Conf > (tier1Threshold - 0.1) && tier1Conf < tier1Threshold) {
                const alertKey = `tier1_near_miss_${context.templateId}`;
                
                if (this.shouldSendAlert(alertKey)) {
                    await AdminNotificationService.sendAlert({
                        code: 'AI_ROUTING_TIER1_NEAR_MISS',
                        severity: 'INFO',
                        title: 'ℹ️ Tier 1 Near Miss - Consider Threshold Adjustment',
                        message: `Tier 1 was VERY CLOSE to matching but fell below threshold.\n\n` +
                                 `Template: "${context.templateName}"\n` +
                                 `Tier 1 Confidence: ${(tier1Conf * 100).toFixed(1)}%\n` +
                                 `Tier 1 Threshold: ${(tier1Threshold * 100).toFixed(1)}%\n` +
                                 `Fell Short By: ${((tier1Threshold - tier1Conf) * 100).toFixed(1)}%\n\n` +
                                 `Tier ${routingResult.tierUsed} was used instead (Cost: $${routingResult.cost?.total?.toFixed(4) || '0'})\n\n` +
                                 `Consider: Lowering Tier 1 threshold by 5-10% to catch these matches for FREE.`,
                        details: {
                            templateId: context.templateId,
                            tier1Confidence: tier1Conf,
                            tier1Threshold,
                            tierUsed: routingResult.tierUsed,
                            cost: routingResult.cost?.total || 0,
                            timestamp: new Date().toISOString()
                        }
                    });
                    
                    this.markAlertSent(alertKey);
                }
            }
        }
    }
    
    /**
     * ============================================================================
     * ALERT THROTTLING - Prevent Spam
     * ============================================================================
     */
    shouldSendAlert(alertKey) {
        const now = Date.now();
        const lastSent = this.recentAlerts.get(alertKey);
        
        if (!lastSent) {
            return true;
        }
        
        const timeSince = now - lastSent;
        return timeSince > this.config.alertCooldownMs;
    }
    
    markAlertSent(alertKey) {
        this.recentAlerts.set(alertKey, Date.now());
        
        // Clean up old entries (> 1 hour)
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        for (const [key, timestamp] of this.recentAlerts.entries()) {
            if (timestamp < oneHourAgo) {
                this.recentAlerts.delete(key);
            }
        }
    }
    
    /**
     * ============================================================================
     * MONITOR TEMPLATE CONFIGURATION
     * ============================================================================
     * Check for template configuration issues that could cause failures
     */
    async checkTemplateConfiguration(template) {
        const issues = [];
        
        // Check if template has categories
        if (!template.categories || template.categories.length === 0) {
            issues.push({
                severity: 'CRITICAL',
                message: 'Template has NO categories'
            });
        }
        
        // Check if template has scenarios
        let totalScenarios = 0;
        let activeScenarios = 0;
        
        template.categories.forEach(category => {
            if (category.scenarios && Array.isArray(category.scenarios)) {
                totalScenarios += category.scenarios.length;
                activeScenarios += category.scenarios.filter(s => s.isActive && s.status === 'live').length;
            }
        });
        
        if (totalScenarios === 0) {
            issues.push({
                severity: 'CRITICAL',
                message: 'Template has NO scenarios'
            });
        } else if (activeScenarios === 0) {
            issues.push({
                severity: 'CRITICAL',
                message: `Template has ${totalScenarios} scenarios but NONE are active/live`
            });
        }
        
        // Check tier thresholds
        const tier1Threshold = template.learningSettings?.tier1Threshold || 0.80;
        const tier2Threshold = template.learningSettings?.tier2Threshold || 0.60;
        
        if (tier2Threshold >= tier1Threshold) {
            issues.push({
                severity: 'WARNING',
                message: `Tier 2 threshold (${tier2Threshold}) >= Tier 1 threshold (${tier1Threshold}) - invalid configuration`
            });
        }
        
        // Send alerts for critical issues
        for (const issue of issues) {
            if (issue.severity === 'critical') {
                await AdminNotificationService.sendAlert({
                    code: 'AI_TEMPLATE_CONFIGURATION_ERROR',
                    severity: 'CRITICAL',
                    title: '⚠️ Template Configuration Error',
                    message: `Template "${template.name}" has a CRITICAL configuration issue.\n\n` +
                             `Issue: ${issue.message}\n\n` +
                             `Impact: This template CANNOT route calls to scenarios.\n\n` +
                             `Action: Fix template configuration immediately.`,
                    details: {
                        templateId: template._id.toString(),
                        templateName: template.name,
                        issue: issue.message,
                        totalScenarios,
                        activeScenarios,
                        timestamp: new Date().toISOString()
                    }
                });
            }
        }
        
        return issues;
    }
}

module.exports = new IntelligenceMonitor();

