// ============================================================================
// 🚨 AI GATEWAY - ALERT ENGINE
// ============================================================================
// PURPOSE: Evaluate health results against smart alert rules
// FEATURES: Pattern detection, consecutive failures, metric thresholds
// INTEGRATIONS: NotificationCenter, AlertRules, HealthLogs
// CREATED: 2025-10-29
// ============================================================================

const { AIGatewayAlertRule, AIGatewayHealthLog } = require('../../models/aiGateway');
const AdminNotificationService = require('../AdminNotificationService');
const logger = require('../../utils/logger');

class AlertEngine {
    // ========================================================================
    // 🏗️ CONSTRUCTOR
    // ========================================================================
    
    constructor() {
        console.log('🏗️ [ALERT ENGINE] Initializing...');
        this.recentFailures = new Map(); // Track consecutive failures per service
        console.log('✅ [ALERT ENGINE] Initialized');
    }
    
    // ========================================================================
    // 🔍 RULE EVALUATION
    // ========================================================================
    
    /**
     * Evaluate all enabled rules against health results
     */
    async evaluateRules(healthResults, triggeredBy = 'auto-ping') {
        console.log('🔍 [ALERT ENGINE] Evaluating alert rules...');
        
        try {
            // Get all enabled rules
            const rules = await AIGatewayAlertRule.find({ enabled: true });
            
            if (rules.length === 0) {
                console.log('ℹ️ [ALERT ENGINE] No enabled rules to evaluate');
                return;
            }
            
            console.log(`🔍 [ALERT ENGINE] Found ${rules.length} enabled rules`);
            
            // Evaluate each rule
            for (const rule of rules) {
                await this.evaluateRule(rule, healthResults, triggeredBy);
            }
            
            console.log('✅ [ALERT ENGINE] Rule evaluation complete');
            
        } catch (error) {
            console.error('❌ [ALERT ENGINE] Failed to evaluate rules:', error.message);
            logger.error('Alert Engine evaluation failed', { error: error.message });
        }
    }
    
    /**
     * Evaluate a single rule
     */
    async evaluateRule(rule, healthResults, triggeredBy) {
        try {
            const service = rule.service;
            const metric = rule.metric;
            
            // Get service data
            const serviceData = service === 'any' ? this.getAnyServiceData(healthResults) : healthResults[service];
            
            if (!serviceData) {
                console.log(`⚠️ [ALERT ENGINE] No data for service: ${service}`);
                return;
            }
            
            // Evaluate based on metric type
            let triggered = false;
            let actualValue = null;
            
            switch (metric) {
                case 'responseTime':
                    actualValue = serviceData.responseTime || serviceData.queryTime || serviceData.latency;
                    triggered = this.evaluateCondition(actualValue, rule.condition.operator, rule.condition.threshold);
                    break;
                    
                case 'failures':
                    // Check for failures in time window
                    triggered = await this.evaluateFailurePattern(service, rule);
                    break;
                    
                case 'consecutiveFailures':
                    triggered = await this.evaluateConsecutiveFailures(service, rule);
                    break;
                    
                case 'uptime':
                    // Calculate uptime from recent checks
                    const uptime = await this.calculateRecentUptime(service, rule.condition.duration);
                    triggered = this.evaluateCondition(uptime, rule.condition.operator, rule.condition.threshold);
                    actualValue = uptime;
                    break;
                    
                default:
                    console.log(`⚠️ [ALERT ENGINE] Unknown metric: ${metric}`);
                    return;
            }
            
            // Handle rule trigger
            if (triggered) {
                console.log(`🚨 [ALERT ENGINE] Rule triggered: ${rule.name}`);
                await this.handleRuleTrigger(rule, serviceData, actualValue, triggeredBy);
            } else {
                // Reset consecutive counter if rule didn't trigger
                if (rule.stats.consecutiveTriggers > 0) {
                    await rule.resetConsecutive();
                }
            }
            
        } catch (error) {
            console.error(`❌ [ALERT ENGINE] Failed to evaluate rule ${rule.name}:`, error.message);
        }
    }
    
    // ========================================================================
    // 🧮 CONDITION EVALUATION
    // ========================================================================
    
    /**
     * Evaluate a simple comparison condition
     */
    evaluateCondition(actualValue, operator, threshold) {
        if (actualValue === null || actualValue === undefined) return false;
        
        switch (operator) {
            case '>': return actualValue > threshold;
            case '<': return actualValue < threshold;
            case '>=': return actualValue >= threshold;
            case '<=': return actualValue <= threshold;
            case '==': return actualValue === threshold;
            case '!=': return actualValue !== threshold;
            default: return false;
        }
    }
    
    /**
     * Get data from any unhealthy service
     */
    getAnyServiceData(healthResults) {
        // Return first unhealthy service data
        for (const [service, data] of Object.entries(healthResults)) {
            if (data.status === 'UNHEALTHY' || data.status === 'CRITICAL') {
                return data;
            }
        }
        return null;
    }
    
    // ========================================================================
    // 📊 PATTERN DETECTION
    // ========================================================================
    
    /**
     * Evaluate failure pattern (X failures in Y time window)
     */
    async evaluateFailurePattern(service, rule) {
        try {
            const duration = rule.condition.duration;
            const threshold = rule.condition.threshold;
            
            if (!duration || !duration.value || !duration.unit) {
                return false;
            }
            
            // Calculate time window
            const windowMs = this.convertToMilliseconds(duration.value, duration.unit);
            const startDate = new Date(Date.now() - windowMs);
            
            // Count failures in time window
            const failures = await AIGatewayHealthLog.countDocuments({
                [`${service}.status`]: { $in: ['UNHEALTHY', 'CRITICAL'] },
                timestamp: { $gte: startDate }
            });
            
            console.log(`📊 [ALERT ENGINE] ${service} failures in window: ${failures} (threshold: ${threshold})`);
            
            return failures >= threshold;
            
        } catch (error) {
            console.error(`❌ [ALERT ENGINE] Failed to evaluate failure pattern:`, error.message);
            return false;
        }
    }
    
    /**
     * Evaluate consecutive failures
     */
    async evaluateConsecutiveFailures(service, rule) {
        try {
            const threshold = rule.condition.threshold;
            
            // Get recent checks
            const recentChecks = await AIGatewayHealthLog.find()
                .sort({ timestamp: -1 })
                .limit(threshold)
                .lean();
            
            if (recentChecks.length < threshold) {
                return false;
            }
            
            // Check if all recent checks failed
            const allFailed = recentChecks.every(check => {
                const status = check[service]?.status;
                return status === 'UNHEALTHY' || status === 'CRITICAL';
            });
            
            if (allFailed) {
                console.log(`🚨 [ALERT ENGINE] ${service} has ${threshold} consecutive failures!`);
            }
            
            return allFailed;
            
        } catch (error) {
            console.error(`❌ [ALERT ENGINE] Failed to evaluate consecutive failures:`, error.message);
            return false;
        }
    }
    
    /**
     * Calculate uptime percentage for recent period
     */
    async calculateRecentUptime(service, duration) {
        try {
            if (!duration || !duration.value || !duration.unit) {
                return 100; // Default to 100% if no duration specified
            }
            
            const windowMs = this.convertToMilliseconds(duration.value, duration.unit);
            const startDate = new Date(Date.now() - windowMs);
            
            const checks = await AIGatewayHealthLog.find({
                timestamp: { $gte: startDate }
            }).lean();
            
            if (checks.length === 0) return 100;
            
            const healthyChecks = checks.filter(check => {
                const status = check[service]?.status;
                return status === 'HEALTHY';
            }).length;
            
            const uptime = (healthyChecks / checks.length) * 100;
            
            console.log(`📊 [ALERT ENGINE] ${service} uptime: ${uptime.toFixed(2)}% (${healthyChecks}/${checks.length})`);
            
            return uptime;
            
        } catch (error) {
            console.error(`❌ [ALERT ENGINE] Failed to calculate uptime:`, error.message);
            return 100;
        }
    }
    
    // ========================================================================
    // 🔔 ALERT HANDLING
    // ========================================================================
    
    /**
     * Handle rule trigger (send alert, create incident)
     */
    async handleRuleTrigger(rule, serviceData, actualValue, triggeredBy) {
        try {
            // Record trigger
            await rule.recordTrigger();
            
            // Build alert message
            const message = rule.action.customMessage || 
                `Alert rule triggered: ${rule.name} (${rule.service}: ${rule.metric} ${rule.condition.operator} ${rule.condition.threshold})`;
            
            const details = {
                ruleName: rule.name,
                service: rule.service,
                metric: rule.metric,
                threshold: rule.condition.threshold,
                actualValue: actualValue,
                serviceStatus: serviceData.status,
                serviceError: serviceData.error,
                triggeredBy: triggeredBy,
                consecutiveTriggers: rule.stats.consecutiveTriggers
            };
            
            // Send notification if enabled
            if (rule.action.notifyAdmin) {
                await AdminNotificationService.sendAlert({
                    code: `AI_GATEWAY_ALERT_RULE_${rule.service.toUpperCase()}`,
                    severity: rule.action.severity,
                    message: message,
                    details: details,
                    source: 'AlertEngine'
                });
                
                console.log(`📢 [ALERT ENGINE] Alert sent: ${rule.name} (${rule.action.severity})`);
            }
            
            // Create incident if enabled
            if (rule.action.createIncident) {
                // TODO: Implement incident creation (Phase 5)
                console.log(`📋 [ALERT ENGINE] Incident creation requested for rule: ${rule.name}`);
            }
            
        } catch (error) {
            console.error(`❌ [ALERT ENGINE] Failed to handle rule trigger:`, error.message);
        }
    }
    
    // ========================================================================
    // 🛠️ UTILITIES
    // ========================================================================
    
    /**
     * Convert duration to milliseconds
     */
    convertToMilliseconds(value, unit) {
        const multipliers = {
            minutes: 60 * 1000,
            hours: 60 * 60 * 1000,
            days: 24 * 60 * 60 * 1000
        };
        
        return value * (multipliers[unit] || multipliers.hours);
    }
    
    // ========================================================================
    // 🌱 DEFAULT RULES SEEDER
    // ========================================================================
    
    /**
     * Create default alert rules if none exist
     */
    async seedDefaultRules() {
        console.log('🌱 [ALERT ENGINE] Checking for default rules...');
        
        try {
            const existingRules = await AIGatewayAlertRule.countDocuments();
            
            if (existingRules > 0) {
                console.log(`ℹ️ [ALERT ENGINE] ${existingRules} rules already exist, skipping seed`);
                return;
            }
            
            console.log('🌱 [ALERT ENGINE] Creating default alert rules...');
            
            const defaultRules = [
                {
                    name: 'OpenAI Slow Response',
                    description: 'Alert when OpenAI response time exceeds 5 seconds',
                    service: 'openai',
                    metric: 'responseTime',
                    condition: {
                        operator: '>',
                        threshold: 5000
                    },
                    action: {
                        severity: 'WARNING',
                        notifyAdmin: true,
                        createIncident: false,
                        customMessage: 'OpenAI response time exceeded 5 seconds'
                    },
                    enabled: true
                },
                {
                    name: 'OpenAI Consecutive Failures',
                    description: 'Alert after 3 consecutive OpenAI failures',
                    service: 'openai',
                    metric: 'consecutiveFailures',
                    condition: {
                        operator: '>=',
                        threshold: 3
                    },
                    action: {
                        severity: 'CRITICAL',
                        notifyAdmin: true,
                        createIncident: true,
                        customMessage: 'OpenAI has failed 3 consecutive health checks'
                    },
                    enabled: true
                },
                {
                    name: 'MongoDB Slow Query',
                    description: 'Alert when MongoDB query time exceeds 1 second',
                    service: 'mongodb',
                    metric: 'responseTime',
                    condition: {
                        operator: '>',
                        threshold: 1000
                    },
                    action: {
                        severity: 'WARNING',
                        notifyAdmin: true,
                        createIncident: false,
                        customMessage: 'MongoDB query time exceeded 1 second'
                    },
                    enabled: true
                },
                {
                    name: 'Redis High Latency',
                    description: 'Alert when Redis latency exceeds 100ms',
                    service: 'redis',
                    metric: 'responseTime',
                    condition: {
                        operator: '>',
                        threshold: 100
                    },
                    action: {
                        severity: 'WARNING',
                        notifyAdmin: true,
                        createIncident: false,
                        customMessage: 'Redis latency exceeded 100ms'
                    },
                    enabled: true
                },
                {
                    name: 'Low Uptime Alert',
                    description: 'Alert when uptime drops below 99% in last 24 hours',
                    service: 'openai',
                    metric: 'uptime',
                    condition: {
                        operator: '<',
                        threshold: 99,
                        duration: { value: 24, unit: 'hours' }
                    },
                    action: {
                        severity: 'WARNING',
                        notifyAdmin: true,
                        createIncident: false,
                        customMessage: 'OpenAI uptime dropped below 99% in last 24 hours'
                    },
                    enabled: false // Disabled by default (requires more data)
                }
            ];
            
            await AIGatewayAlertRule.insertMany(defaultRules);
            
            console.log(`✅ [ALERT ENGINE] Created ${defaultRules.length} default alert rules`);
            
        } catch (error) {
            console.error('❌ [ALERT ENGINE] Failed to seed default rules:', error.message);
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// 📦 SINGLETON EXPORT
// ────────────────────────────────────────────────────────────────────────────

module.exports = new AlertEngine();

