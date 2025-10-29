// ============================================================================
// 💰 AI GATEWAY - COST TRACKER SERVICE
// ============================================================================
// PURPOSE: Track OpenAI costs, manage budgets, send budget alerts
// FEATURES: Cost aggregation, budget tracking, trend analysis
// INTEGRATIONS: CostLog model, AdminNotificationService
// CREATED: 2025-10-29
// ============================================================================

const { AIGatewayCostLog } = require('../../models/aiGateway');
const AdminNotificationService = require('../AdminNotificationService');
const AdminSettings = require('../../models/AdminSettings');
const logger = require('../../utils/logger');

// OpenAI Pricing (as of 2025-10-29)
const PRICING = {
    'gpt-4o-mini': {
        input: 0.150 / 1_000_000,  // $0.15 per 1M tokens
        output: 0.600 / 1_000_000   // $0.60 per 1M tokens
    },
    'gpt-4o': {
        input: 2.50 / 1_000_000,
        output: 10.00 / 1_000_000
    },
    'gpt-4-turbo': {
        input: 10.00 / 1_000_000,
        output: 30.00 / 1_000_000
    }
};

class CostTracker {
    // ========================================================================
    // 🏗️ CONSTRUCTOR
    // ========================================================================
    
    constructor() {
        console.log('🏗️ [COST TRACKER] Initializing...');
        console.log('✅ [COST TRACKER] Initialized');
    }
    
    // ========================================================================
    // 💰 COST CALCULATION
    // ========================================================================
    
    /**
     * Calculate cost for OpenAI API call
     */
    calculateCost(model, inputTokens, outputTokens) {
        const pricing = PRICING[model] || PRICING['gpt-4o-mini'];
        
        const inputCost = inputTokens * pricing.input;
        const outputCost = outputTokens * pricing.output;
        const totalCost = inputCost + outputCost;
        
        return parseFloat(totalCost.toFixed(6)); // 6 decimal places for accuracy
    }
    
    /**
     * Log a cost entry
     */
    async logCost(data) {
        try {
            const { operationType, model, inputTokens, outputTokens, templateId, callId, companyId } = data;
            
            const cost = this.calculateCost(model, inputTokens, outputTokens);
            
            const costLog = await AIGatewayCostLog.create({
                operationType,
                service: 'openai',
                model,
                tokensUsed: {
                    input: inputTokens,
                    output: outputTokens,
                    total: inputTokens + outputTokens
                },
                cost,
                templateId,
                callId,
                companyId
            });
            
            console.log(`💰 [COST TRACKER] Logged: ${operationType} | ${model} | $${cost}`);
            
            return costLog;
            
        } catch (error) {
            console.error('❌ [COST TRACKER] Failed to log cost:', error.message);
            logger.error('Cost logging failed', { error: error.message, data });
        }
    }
    
    // ========================================================================
    // 📊 COST AGGREGATION
    // ========================================================================
    
    /**
     * Get cost summary for current month
     */
    async getMonthlyCosts() {
        try {
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            
            const result = await AIGatewayCostLog.aggregate([
                {
                    $match: {
                        timestamp: { $gte: startOfMonth }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: '$cost' },
                        totalCalls: { $sum: 1 },
                        totalTokens: { $sum: '$tokensUsed.total' }
                    }
                }
            ]);
            
            const summary = result[0] || { totalCost: 0, totalCalls: 0, totalTokens: 0 };
            
            // Get breakdown by operation type
            const breakdown = await AIGatewayCostLog.aggregate([
                {
                    $match: {
                        timestamp: { $gte: startOfMonth }
                    }
                },
                {
                    $group: {
                        _id: '$operationType',
                        cost: { $sum: '$cost' },
                        calls: { $sum: 1 }
                    }
                }
            ]);
            
            return {
                period: 'current_month',
                totalCost: parseFloat(summary.totalCost.toFixed(2)),
                totalCalls: summary.totalCalls,
                totalTokens: summary.totalTokens,
                breakdown: breakdown.reduce((acc, item) => {
                    acc[item._id] = {
                        cost: parseFloat(item.cost.toFixed(2)),
                        calls: item.calls,
                        percentage: ((item.cost / summary.totalCost) * 100).toFixed(1)
                    };
                    return acc;
                }, {})
            };
            
        } catch (error) {
            console.error('❌ [COST TRACKER] Failed to get monthly costs:', error.message);
            return {
                period: 'current_month',
                totalCost: 0,
                totalCalls: 0,
                totalTokens: 0,
                breakdown: {}
            };
        }
    }
    
    /**
     * Get daily cost trend
     */
    async getDailyCostTrend(days = 30) {
        try {
            const costs = await AIGatewayCostLog.getDailyCosts(days);
            
            return {
                period: `${days} days`,
                dataPoints: costs
            };
            
        } catch (error) {
            console.error('❌ [COST TRACKER] Failed to get daily trend:', error.message);
            return {
                period: `${days} days`,
                dataPoints: []
            };
        }
    }
    
    // ========================================================================
    // 🚨 BUDGET MANAGEMENT
    // ========================================================================
    
    /**
     * Check budget and send alerts if needed
     */
    async checkBudget() {
        try {
            // Get monthly costs
            const costs = await this.getMonthlyCosts();
            
            // Get budget from AdminSettings (default: $500/month)
            const settings = await AdminSettings.findOne();
            const budget = settings?.aiGatewayHealthCheck?.monthlyBudget || 500;
            
            const percentUsed = (costs.totalCost / budget) * 100;
            
            console.log(`💰 [COST TRACKER] Budget check: $${costs.totalCost} / $${budget} (${percentUsed.toFixed(1)}%)`);
            
            // Send alerts at thresholds
            if (percentUsed >= 100 && !this.alreadyAlerted('100%')) {
                await this.sendBudgetAlert('CRITICAL', costs.totalCost, budget, percentUsed);
                this.markAlerted('100%');
            } else if (percentUsed >= 90 && !this.alreadyAlerted('90%')) {
                await this.sendBudgetAlert('CRITICAL', costs.totalCost, budget, percentUsed);
                this.markAlerted('90%');
            } else if (percentUsed >= 80 && !this.alreadyAlerted('80%')) {
                await this.sendBudgetAlert('WARNING', costs.totalCost, budget, percentUsed);
                this.markAlerted('80%');
            }
            
            return {
                budget,
                spent: costs.totalCost,
                remaining: Math.max(0, budget - costs.totalCost),
                percentUsed: parseFloat(percentUsed.toFixed(1)),
                onTrack: percentUsed < 80
            };
            
        } catch (error) {
            console.error('❌ [COST TRACKER] Failed to check budget:', error.message);
            return null;
        }
    }
    
    /**
     * Send budget alert
     */
    async sendBudgetAlert(severity, spent, budget, percentUsed) {
        try {
            const message = `OpenAI costs at ${percentUsed.toFixed(1)}% of monthly budget ($${spent} / $${budget})`;
            
            await AdminNotificationService.sendAlert({
                code: 'AI_GATEWAY_BUDGET_WARNING',
                severity,
                message,
                details: {
                    budget,
                    spent,
                    remaining: budget - spent,
                    percentUsed: percentUsed.toFixed(1)
                },
                source: 'CostTracker'
            });
            
            console.log(`📢 [COST TRACKER] Sent ${severity} budget alert: ${percentUsed.toFixed(1)}%`);
            
        } catch (error) {
            console.error('❌ [COST TRACKER] Failed to send budget alert:', error.message);
        }
    }
    
    /**
     * Track which alerts have been sent (reset monthly)
     */
    alreadyAlerted(threshold) {
        const now = new Date();
        const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
        
        if (!this.alertCache) {
            this.alertCache = {};
        }
        
        if (this.alertCache.month !== monthKey) {
            // New month, reset cache
            this.alertCache = { month: monthKey, sent: [] };
        }
        
        return this.alertCache.sent.includes(threshold);
    }
    
    markAlerted(threshold) {
        if (!this.alertCache.sent) {
            this.alertCache.sent = [];
        }
        this.alertCache.sent.push(threshold);
    }
    
    // ========================================================================
    // 📈 FORECASTING
    // ========================================================================
    
    /**
     * Forecast end-of-month cost based on current trend
     */
    async forecastMonthEnd() {
        try {
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const daysPassed = now.getDate();
            
            const costs = await this.getMonthlyCosts();
            const dailyAverage = costs.totalCost / daysPassed;
            const forecast = dailyAverage * daysInMonth;
            
            return {
                currentSpend: costs.totalCost,
                dailyAverage: parseFloat(dailyAverage.toFixed(2)),
                forecastedTotal: parseFloat(forecast.toFixed(2)),
                daysRemaining: daysInMonth - daysPassed
            };
            
        } catch (error) {
            console.error('❌ [COST TRACKER] Failed to forecast:', error.message);
            return null;
        }
    }
    
    // ========================================================================
    // 💡 OPTIMIZATION RECOMMENDATIONS
    // ========================================================================
    
    /**
     * Generate cost optimization recommendations
     */
    async getOptimizationRecommendations() {
        try {
            const costs = await this.getMonthlyCosts();
            const recommendations = [];
            
            // Check if using expensive models
            const expensiveModels = await AIGatewayCostLog.aggregate([
                {
                    $match: {
                        model: { $in: ['gpt-4o', 'gpt-4-turbo'] }
                    }
                },
                {
                    $group: {
                        _id: '$model',
                        cost: { $sum: '$cost' },
                        calls: { $sum: 1 }
                    }
                }
            ]);
            
            if (expensiveModels.length > 0) {
                const savings = expensiveModels.reduce((sum, m) => sum + m.cost, 0) * 0.95;
                recommendations.push({
                    type: 'model_downgrade',
                    message: `Switch to gpt-4o-mini for health checks and non-critical calls`,
                    estimatedSavings: parseFloat(savings.toFixed(2)),
                    impact: 'low'
                });
            }
            
            // Check health check costs
            const healthCheckCosts = costs.breakdown.health_check?.cost || 0;
            if (healthCheckCosts > 5) {
                recommendations.push({
                    type: 'reduce_frequency',
                    message: `Health check costs are high ($${healthCheckCosts}). Consider reducing frequency.`,
                    estimatedSavings: parseFloat((healthCheckCosts * 0.5).toFixed(2)),
                    impact: 'medium'
                });
            }
            
            // Check if budget should be increased
            const forecast = await this.forecastMonthEnd();
            if (forecast && forecast.forecastedTotal > costs.totalCost * 1.2) {
                recommendations.push({
                    type: 'increase_budget',
                    message: `Forecasted costs ($${forecast.forecastedTotal}) exceed current spending. Consider budget adjustment.`,
                    estimatedSavings: 0,
                    impact: 'high'
                });
            }
            
            return recommendations;
            
        } catch (error) {
            console.error('❌ [COST TRACKER] Failed to generate recommendations:', error.message);
            return [];
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// 📦 SINGLETON EXPORT
// ────────────────────────────────────────────────────────────────────────────

module.exports = new CostTracker();

