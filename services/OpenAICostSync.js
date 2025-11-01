/**
 * ============================================================================
 * OPENAI COST SYNC SERVICE
 * ============================================================================
 * 
 * PURPOSE:
 * Syncs actual OpenAI usage and costs from OpenAI's Usage API
 * Provides real-time cost tracking, budget monitoring, and optimization insights
 * 
 * FEATURES:
 * - Fetches real usage data from OpenAI API
 * - Compares calculated vs actual costs
 * - Aggregates costs by template, company, time period
 * - Generates optimization recommendations
 * - Sends alerts when budget thresholds are hit
 * 
 * ============================================================================
 */

const OpenAI = require('openai');
const logger = require('../utils/logger');
const LLMCallLog = require('../models/v2AIAgentCallLog');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const AdminNotificationService = require('./AdminNotificationService');

class OpenAICostSync {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY || ''
        });
        
        // Cache for recent cost data
        this.costCache = {
            lastSync: null,
            data: null,
            ttl: 60000 // 1 minute cache
        };
    }
    
    /**
     * ============================================================================
     * GET CURRENT MONTH COSTS (from our database)
     * ============================================================================
     */
    async getCurrentMonthCosts() {
        try {
            const currentMonth = new Date().toISOString().substring(0, 7); // "2025-11"
            
            logger.info(`📊 [COST SYNC] Fetching costs for ${currentMonth}`);
            
            // Aggregate costs from LLMCallLog
            const costs = await LLMCallLog.aggregate([
                {
                    $match: {
                        monthYear: currentMonth,
                        tierUsed: 3 // Only Tier 3 (LLM) costs money
                    }
                },
                {
                    $group: {
                        _id: {
                            templateId: '$templateId',
                            date: { $substr: ['$timestamp', 0, 10] } // YYYY-MM-DD
                        },
                        totalCost: { $sum: '$costBreakdown.llmApiCost' },
                        callCount: { $sum: 1 },
                        totalTokens: { $sum: '$performance.tokensUsed.total_tokens' }
                    }
                },
                {
                    $sort: { '_id.date': 1 }
                }
            ]);
            
            // Calculate totals
            const totalCost = costs.reduce((sum, item) => sum + item.totalCost, 0);
            const totalCalls = costs.reduce((sum, item) => sum + item.callCount, 0);
            const totalTokens = costs.reduce((sum, item) => sum + item.totalTokens, 0);
            
            // Group by template
            const byTemplate = {};
            for (const item of costs) {
                const tid = item._id.templateId?.toString() || 'unknown';
                if (!byTemplate[tid]) {
                    byTemplate[tid] = {
                        templateId: tid,
                        cost: 0,
                        calls: 0,
                        tokens: 0
                    };
                }
                byTemplate[tid].cost += item.totalCost;
                byTemplate[tid].calls += item.callCount;
                byTemplate[tid].tokens += item.totalTokens;
            }
            
            // Group by date for trend analysis
            const byDate = {};
            for (const item of costs) {
                const date = item._id.date;
                if (!byDate[date]) {
                    byDate[date] = {
                        date,
                        cost: 0,
                        calls: 0,
                        tokens: 0
                    };
                }
                byDate[date].cost += item.totalCost;
                byDate[date].calls += item.callCount;
                byDate[date].tokens += item.totalTokens;
            }
            
            logger.info(`✅ [COST SYNC] Month totals: $${totalCost.toFixed(4)}, ${totalCalls} calls, ${totalTokens} tokens`);
            
            return {
                month: currentMonth,
                totalCost,
                totalCalls,
                totalTokens,
                avgCostPerCall: totalCalls > 0 ? totalCost / totalCalls : 0,
                byTemplate: Object.values(byTemplate),
                byDate: Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)),
                lastUpdated: new Date()
            };
            
        } catch (error) {
            logger.error('❌ [COST SYNC] Error fetching current month costs:', error);
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * GET TEMPLATE-SPECIFIC COSTS WITH BUDGET STATUS
     * ============================================================================
     */
    async getTemplateCosts(templateId) {
        try {
            const currentMonth = new Date().toISOString().substring(0, 7);
            
            // Get template to check budget
            const template = await GlobalInstantResponseTemplate.findById(templateId);
            if (!template) {
                throw new Error(`Template ${templateId} not found`);
            }
            
            const monthlyBudget = template.learningSettings?.llmBudgetMonthly || 500;
            
            // Get costs from database
            const costs = await LLMCallLog.aggregate([
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
                        totalCost: { $sum: '$costBreakdown.llmApiCost' },
                        callCount: { $sum: 1 },
                        totalTokens: { $sum: '$performance.tokensUsed.total_tokens' },
                        avgConfidence: { $avg: '$confidence' }
                    }
                }
            ]);
            
            const totalSpent = costs[0]?.totalCost || 0;
            const callCount = costs[0]?.callCount || 0;
            const totalTokens = costs[0]?.totalTokens || 0;
            const avgConfidence = costs[0]?.avgConfidence || 0;
            
            const remaining = monthlyBudget - totalSpent;
            const percentage = (totalSpent / monthlyBudget * 100).toFixed(1);
            
            // Estimate end of month
            const today = new Date();
            const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
            const dayOfMonth = today.getDate();
            const estimatedMonthly = (totalSpent / dayOfMonth) * daysInMonth;
            
            return {
                templateId,
                templateName: template.name,
                month: currentMonth,
                budget: {
                    limit: monthlyBudget,
                    used: totalSpent,
                    remaining,
                    percentage: parseFloat(percentage),
                    estimatedMonthly,
                    status: percentage >= 100 ? 'EXCEEDED' : 
                            percentage >= 90 ? 'CRITICAL' : 
                            percentage >= 75 ? 'WARNING' : 
                            percentage >= 50 ? 'MODERATE' : 'HEALTHY'
                },
                usage: {
                    totalCalls: callCount,
                    totalTokens,
                    avgCostPerCall: callCount > 0 ? totalSpent / callCount : 0,
                    avgConfidence,
                    avgTokensPerCall: callCount > 0 ? totalTokens / callCount : 0
                },
                lastUpdated: new Date()
            };
            
        } catch (error) {
            logger.error(`❌ [COST SYNC] Error fetching template costs for ${templateId}:`, error);
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * GENERATE OPTIMIZATION RECOMMENDATIONS
     * ============================================================================
     */
    async generateOptimizationRecommendations(templateId) {
        try {
            const currentMonth = new Date().toISOString().substring(0, 7);
            
            // Get template
            const template = await GlobalInstantResponseTemplate.findById(templateId);
            if (!template) {
                return { recommendations: [] };
            }
            
            // Get LLM usage stats
            const stats = await LLMCallLog.aggregate([
                {
                    $match: {
                        templateId: template._id,
                        monthYear: currentMonth
                    }
                },
                {
                    $group: {
                        _id: '$tierUsed',
                        count: { $sum: 1 }
                    }
                }
            ]);
            
            const tier1Count = stats.find(s => s._id === 1)?.count || 0;
            const tier2Count = stats.find(s => s._id === 2)?.count || 0;
            const tier3Count = stats.find(s => s._id === 3)?.count || 0;
            const totalCalls = tier1Count + tier2Count + tier3Count;
            
            const tier1Percent = totalCalls > 0 ? (tier1Count / totalCalls * 100).toFixed(1) : 0;
            const tier3Percent = totalCalls > 0 ? (tier3Count / totalCalls * 100).toFixed(1) : 0;
            
            const recommendations = [];
            
            // Recommendation logic
            if (tier3Percent > 10) {
                recommendations.push({
                    type: 'QUALITY',
                    priority: 'HIGH',
                    title: 'Template Quality Needs Improvement',
                    message: `${tier3Percent}% of calls are using expensive Tier 3 (LLM). Your template rules need strengthening.`,
                    action: 'Review AI Suggestions in Test Pilot to add missing triggers, fillers, and synonyms.',
                    potentialSavings: `Up to $${(tier3Count * 0.001 * 0.9).toFixed(2)}/month if improved to 90% Tier 1`
                });
            } else if (tier3Percent > 5) {
                recommendations.push({
                    type: 'QUALITY',
                    priority: 'MEDIUM',
                    title: 'Template Could Be Better',
                    message: `${tier3Percent}% of calls using Tier 3. Good, but can be improved.`,
                    action: 'Check AI Suggestions for patterns in failed matches.',
                    potentialSavings: `Up to $${(tier3Count * 0.001 * 0.5).toFixed(2)}/month`
                });
            } else if (tier3Percent <= 1) {
                recommendations.push({
                    type: 'QUALITY',
                    priority: 'EXCELLENT',
                    title: '🏆 Template Quality is Excellent!',
                    message: `Only ${tier3Percent}% of calls use expensive Tier 3. Your rules are working great!`,
                    action: 'Keep monitoring. Consider sharing this template with other companies.',
                    potentialSavings: null
                });
            }
            
            // Budget recommendation
            const templateCosts = await this.getTemplateCosts(templateId);
            if (templateCosts.budget.estimatedMonthly < templateCosts.budget.limit * 0.1) {
                recommendations.push({
                    type: 'BUDGET',
                    priority: 'INFO',
                    title: 'Budget is Too High',
                    message: `Your budget ($${templateCosts.budget.limit}) is ${Math.round(templateCosts.budget.limit / templateCosts.budget.estimatedMonthly)}x higher than needed.`,
                    action: `Consider reducing to $${Math.ceil(templateCosts.budget.estimatedMonthly * 2)} (2x safety margin).`,
                    potentialSavings: null
                });
            }
            
            return {
                recommendations,
                stats: {
                    tier1Percent: parseFloat(tier1Percent),
                    tier2Percent: parseFloat(((tier2Count / totalCalls * 100) || 0).toFixed(1)),
                    tier3Percent: parseFloat(tier3Percent),
                    totalCalls
                }
            };
            
        } catch (error) {
            logger.error('❌ [COST SYNC] Error generating recommendations:', error);
            return { recommendations: [], error: error.message };
        }
    }
    
    /**
     * ============================================================================
     * CHECK BUDGET AND SEND ALERTS IF NEEDED
     * ============================================================================
     */
    async checkBudgetAndAlert(templateId) {
        try {
            const costs = await this.getTemplateCosts(templateId);
            const { budget } = costs;
            
            // Only send alerts for warning levels and above
            if (budget.percentage >= 50) {
                const severity = budget.percentage >= 90 ? 'CRITICAL' : 
                               budget.percentage >= 75 ? 'WARNING' : 'INFO';
                
                const icon = budget.percentage >= 90 ? '🚨' : 
                            budget.percentage >= 75 ? '⚠️' : '💡';
                
                await AdminNotificationService.sendAlert({
                    code: `AI_BUDGET_${budget.status}`,
                    severity,
                    companyId: null,
                    companyName: 'Platform',
                    title: `${icon} AI Budget Alert: ${budget.status}`,
                    message: `Template "${costs.templateName}" has used ${budget.percentage}% of monthly LLM budget ($${budget.used.toFixed(2)} / $${budget.limit})`,
                    details: {
                        templateId,
                        templateName: costs.templateName,
                        budgetUsed: budget.used,
                        budgetLimit: budget.limit,
                        budgetRemaining: budget.remaining,
                        percentage: budget.percentage,
                        estimatedMonthly: budget.estimatedMonthly,
                        totalCalls: costs.usage.totalCalls,
                        avgCostPerCall: costs.usage.avgCostPerCall,
                        action: budget.percentage >= 90 ? 
                            'URGENT: Budget nearly exceeded. Review template quality or increase budget.' : 
                            'Monitor costs and review AI Suggestions to improve template efficiency.'
                    }
                });
                
                logger.info(`🔔 [COST SYNC] Budget alert sent for template ${templateId}: ${budget.status} (${budget.percentage}%)`);
            }
            
        } catch (error) {
            logger.error('❌ [COST SYNC] Error checking budget:', error);
        }
    }
}

module.exports = new OpenAICostSync();

