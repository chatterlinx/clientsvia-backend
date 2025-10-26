/**
 * ============================================================================
 * COST TRACKING SERVICE - SELF-IMPROVEMENT ANALYTICS
 * ============================================================================
 * 
 * PURPOSE:
 * Aggregates and analyzes cost data from LLMCallLog to provide insights into
 * the self-improvement cycle. Tracks the Week 1 → Week 24 progression from
 * 70% LLM usage ($350/month) to 2% LLM usage ($10/month).
 * 
 * KEY METRICS:
 * - Tier distribution over time (% using each tier)
 * - Cost trends (daily, weekly, monthly)
 * - Patterns learned count
 * - ROI calculations (savings vs baseline)
 * - Self-improvement score (0-100)
 * 
 * BUSINESS VALUE:
 * - Prove ROI to stakeholders
 * - Track learning effectiveness
 * - Optimize tier thresholds
 * - Forecast future costs
 * - Identify underperforming templates
 * 
 * ============================================================================
 */

const LLMCallLog = require('../models/LLMCallLog');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const logger = require('../utils/logger');

class CostTrackingService {
    constructor() {
        this.config = {
            // Baseline costs (Week 1)
            baselineTier3Percentage: 70,
            baselineMonthlyCost: 350,
            
            // Target costs (Week 24)
            targetTier3Percentage: 2,
            targetMonthlyCost: 10,
            
            // Caching
            cacheEnabled: true,
            cacheTTL: 300000  // 5 minutes
        };
        
        // Simple in-memory cache
        this.cache = new Map();
    }
    
    /**
     * ============================================================================
     * GET INTELLIGENCE METRICS FOR A TEMPLATE
     * ============================================================================
     * Complete dashboard data: tier distribution, costs, patterns, trends
     */
    async getIntelligenceMetrics(templateId, options = {}) {
        const startTime = Date.now();
        
        try {
            logger.info('📊 [COST TRACKING] Getting intelligence metrics', {
                templateId,
                options
            });
            
            // Get template
            const template = await GlobalInstantResponseTemplate.findById(templateId);
            if (!template) {
                throw new Error('Template not found');
            }
            
            // Calculate time ranges
            const now = new Date();
            const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
            
            // Get metrics in parallel
            const [
                currentMonthMetrics,
                lastMonthMetrics,
                weeklyProgression,
                tierDistribution,
                costTrend,
                learningMetrics
            ] = await Promise.all([
                this.getMonthlyMetrics(templateId, currentMonth),
                this.getMonthlyMetrics(templateId, lastMonth),
                this.getWeeklyProgression(templateId),
                this.getTierDistribution(templateId, weekAgo, now),
                this.getCostTrend(templateId, 30),  // Last 30 days
                this.getLearningMetrics(templateId)
            ]);
            
            // Calculate self-improvement score
            const selfImprovementScore = this.calculateSelfImprovementScore({
                currentMonthMetrics,
                weeklyProgression,
                learningMetrics
            });
            
            // Calculate ROI
            const roi = this.calculateROI(currentMonthMetrics, this.config.baselineMonthlyCost);
            
            const processingTime = Date.now() - startTime;
            
            logger.info('✅ [COST TRACKING] Metrics retrieved', {
                templateId,
                processingTime: `${processingTime}ms`
            });
            
            return {
                success: true,
                templateId,
                templateName: template.name,
                
                // Current month overview
                currentMonth: {
                    ...currentMonthMetrics,
                    selfImprovementScore,
                    roi
                },
                
                // Last month comparison
                lastMonth: lastMonthMetrics,
                
                // Month-over-month changes
                monthOverMonth: {
                    costChange: currentMonthMetrics.totalCost - lastMonthMetrics.totalCost,
                    costChangePercentage: lastMonthMetrics.totalCost > 0 
                        ? ((currentMonthMetrics.totalCost - lastMonthMetrics.totalCost) / lastMonthMetrics.totalCost * 100).toFixed(1)
                        : 0,
                    tier1Improvement: (currentMonthMetrics.tierDistribution.tier1.percentage - lastMonthMetrics.tierDistribution.tier1.percentage).toFixed(1),
                    tier3Reduction: (lastMonthMetrics.tierDistribution.tier3.percentage - currentMonthMetrics.tierDistribution.tier3.percentage).toFixed(1)
                },
                
                // Weekly progression (Week 1 → current)
                weeklyProgression,
                
                // Detailed tier distribution
                tierDistribution,
                
                // Cost trend (daily breakdown)
                costTrend,
                
                // Learning metrics
                learning: learningMetrics,
                
                // Timestamps
                generatedAt: new Date(),
                processingTime
            };
            
        } catch (error) {
            logger.error('❌ [COST TRACKING] Error getting metrics', {
                templateId,
                error: error.message
            });
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * GET MONTHLY METRICS
     * ============================================================================
     */
    async getMonthlyMetrics(templateId, monthStart) {
        const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59);
        
        const pipeline = [
            {
                $match: {
                    templateId,
                    createdAt: { $gte: monthStart, $lte: monthEnd }
                }
            },
            {
                $group: {
                    _id: '$tierUsed',
                    count: { $sum: 1 },
                    totalCost: { $sum: '$costBreakdown.totalCost' },
                    avgResponseTime: { $avg: '$performanceMetrics.totalTime' },
                    patternsLearned: { $sum: { $size: { $ifNull: ['$patternsLearned', []] } } }
                }
            }
        ];
        
        const results = await LLMCallLog.aggregate(pipeline);
        
        const totalCalls = results.reduce((sum, r) => sum + r.count, 0);
        const totalCost = results.reduce((sum, r) => sum + r.totalCost, 0);
        const totalPatterns = results.reduce((sum, r) => sum + r.patternsLearned, 0);
        
        // Build tier distribution
        const tier1 = results.find(r => r._id === 1) || { count: 0, totalCost: 0, avgResponseTime: 0 };
        const tier2 = results.find(r => r._id === 2) || { count: 0, totalCost: 0, avgResponseTime: 0 };
        const tier3 = results.find(r => r._id === 3) || { count: 0, totalCost: 0, avgResponseTime: 0 };
        
        return {
            monthStart,
            monthEnd,
            totalCalls,
            totalCost: parseFloat(totalCost.toFixed(2)),
            patternsLearned: totalPatterns,
            avgCostPerCall: totalCalls > 0 ? parseFloat((totalCost / totalCalls).toFixed(4)) : 0,
            
            tierDistribution: {
                tier1: {
                    count: tier1.count,
                    percentage: totalCalls > 0 ? parseFloat((tier1.count / totalCalls * 100).toFixed(1)) : 0,
                    avgResponseTime: Math.round(tier1.avgResponseTime || 0),
                    cost: parseFloat((tier1.totalCost || 0).toFixed(2))
                },
                tier2: {
                    count: tier2.count,
                    percentage: totalCalls > 0 ? parseFloat((tier2.count / totalCalls * 100).toFixed(1)) : 0,
                    avgResponseTime: Math.round(tier2.avgResponseTime || 0),
                    cost: parseFloat((tier2.totalCost || 0).toFixed(2))
                },
                tier3: {
                    count: tier3.count,
                    percentage: totalCalls > 0 ? parseFloat((tier3.count / totalCalls * 100).toFixed(1)) : 0,
                    avgResponseTime: Math.round(tier3.avgResponseTime || 0),
                    cost: parseFloat((tier3.totalCost || 0).toFixed(2))
                }
            }
        };
    }
    
    /**
     * ============================================================================
     * GET WEEKLY PROGRESSION
     * ============================================================================
     * Shows Week 1 → Week 24 progression for self-improvement cycle
     */
    async getWeeklyProgression(templateId) {
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            throw new Error('Template not found');
        }
        
        const progression = await LLMCallLog.getWeeklyProgression(templateId);
        
        // Format for frontend
        return progression.map(week => ({
            week: week._id,
            tier1: week.tier1,
            tier2: week.tier2,
            tier3: week.tier3,
            tier1Percentage: week.tier1 + week.tier2 + week.tier3 > 0 
                ? ((week.tier1 / (week.tier1 + week.tier2 + week.tier3)) * 100).toFixed(1)
                : 0,
            tier2Percentage: week.tier1 + week.tier2 + week.tier3 > 0 
                ? ((week.tier2 / (week.tier1 + week.tier2 + week.tier3)) * 100).toFixed(1)
                : 0,
            tier3Percentage: week.tier1 + week.tier2 + week.tier3 > 0 
                ? ((week.tier3 / (week.tier1 + week.tier2 + week.tier3)) * 100).toFixed(1)
                : 0,
            totalCost: parseFloat(week.totalCost.toFixed(2)),
            patternsLearned: week.patternsLearned
        }));
    }
    
    /**
     * ============================================================================
     * GET TIER DISTRIBUTION
     * ============================================================================
     */
    async getTierDistribution(templateId, startDate, endDate) {
        return await LLMCallLog.getTierDistribution(templateId, startDate, endDate);
    }
    
    /**
     * ============================================================================
     * GET COST TREND
     * ============================================================================
     * Daily cost breakdown for the last N days
     */
    async getCostTrend(templateId, days = 30) {
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        
        const pipeline = [
            {
                $match: {
                    templateId,
                    createdAt: { $gte: startDate }
                }
            },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' },
                        day: { $dayOfMonth: '$createdAt' }
                    },
                    totalCalls: { $sum: 1 },
                    tier1Calls: { $sum: { $cond: [{ $eq: ['$tierUsed', 1] }, 1, 0] } },
                    tier2Calls: { $sum: { $cond: [{ $eq: ['$tierUsed', 2] }, 1, 0] } },
                    tier3Calls: { $sum: { $cond: [{ $eq: ['$tierUsed', 3] }, 1, 0] } },
                    totalCost: { $sum: '$costBreakdown.totalCost' },
                    patternsLearned: { $sum: { $size: { $ifNull: ['$patternsLearned', []] } } }
                }
            },
            {
                $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
            }
        ];
        
        const results = await LLMCallLog.aggregate(pipeline);
        
        return results.map(day => ({
            date: new Date(day._id.year, day._id.month - 1, day._id.day).toISOString().split('T')[0],
            totalCalls: day.totalCalls,
            tier1Calls: day.tier1Calls,
            tier2Calls: day.tier2Calls,
            tier3Calls: day.tier3Calls,
            totalCost: parseFloat(day.totalCost.toFixed(2)),
            patternsLearned: day.patternsLearned
        }));
    }
    
    /**
     * ============================================================================
     * GET LEARNING METRICS
     * ============================================================================
     */
    async getLearningMetrics(templateId) {
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            throw new Error('Template not found');
        }
        
        const stats = template.learningStats || {};
        
        return {
            patternsLearnedTotal: stats.patternsLearnedTotal || 0,
            patternsLearnedThisMonth: stats.patternsLearnedThisMonth || 0,
            synonymsLearned: stats.synonymsLearned || 0,
            fillersLearned: stats.fillersLearned || 0,
            keywordsLearned: stats.keywordsLearned || 0,
            
            sharing: {
                patternsSharedToIndustry: stats.patternsSharedToIndustry || 0,
                patternsSharedGlobally: stats.patternsSharedGlobally || 0,
                patternsReceivedFromIndustry: stats.patternsReceivedFromIndustry || 0,
                patternsReceivedGlobal: stats.patternsReceivedGlobal || 0
            },
            
            timestamps: {
                firstLearningEvent: stats.firstLearningEvent,
                lastLearningEvent: stats.lastLearningEvent,
                lastStatsReset: stats.lastStatsReset
            }
        };
    }
    
    /**
     * ============================================================================
     * CALCULATE SELF-IMPROVEMENT SCORE (0-100)
     * ============================================================================
     * Higher score = better self-improvement progress
     */
    calculateSelfImprovementScore({ currentMonthMetrics, weeklyProgression, learningMetrics }) {
        const weights = {
            tier1Usage: 0.35,      // 35% weight: More Tier 1 = better
            costReduction: 0.30,   // 30% weight: Lower costs = better
            patternsLearned: 0.20, // 20% weight: More learning = better
            consistency: 0.15      // 15% weight: Consistent improvement = better
        };
        
        // Component 1: Tier 1 usage (target: 85%)
        const tier1Score = Math.min(currentMonthMetrics.tierDistribution.tier1.percentage / 85, 1);
        
        // Component 2: Cost reduction vs baseline (target: 97% reduction)
        const costReductionPercentage = ((this.config.baselineMonthlyCost - currentMonthMetrics.totalCost) / this.config.baselineMonthlyCost);
        const costScore = Math.min(costReductionPercentage / 0.97, 1);
        
        // Component 3: Patterns learned (target: 100+)
        const patternsScore = Math.min(learningMetrics.patternsLearnedTotal / 100, 1);
        
        // Component 4: Consistency (are we trending upward?)
        let consistencyScore = 0.5;  // Default neutral
        if (weeklyProgression.length >= 4) {
            const recent4Weeks = weeklyProgression.slice(-4);
            const tier1Trend = recent4Weeks.map(w => parseFloat(w.tier1Percentage));
            const isImproving = tier1Trend.every((val, i) => i === 0 || val >= tier1Trend[i - 1]);
            consistencyScore = isImproving ? 1.0 : 0.3;
        }
        
        // Calculate weighted score
        const totalScore = 
            (tier1Score * weights.tier1Usage) +
            (costScore * weights.costReduction) +
            (patternsScore * weights.patternsLearned) +
            (consistencyScore * weights.consistency);
        
        return Math.round(totalScore * 100);
    }
    
    /**
     * ============================================================================
     * CALCULATE ROI
     * ============================================================================
     */
    calculateROI(currentMonthMetrics, baselineCost) {
        const savings = baselineCost - currentMonthMetrics.totalCost;
        const savingsPercentage = baselineCost > 0 ? (savings / baselineCost * 100).toFixed(1) : 0;
        const projectedAnnualSavings = savings * 12;
        
        return {
            baselineCost,
            currentCost: currentMonthMetrics.totalCost,
            monthlySavings: parseFloat(savings.toFixed(2)),
            savingsPercentage: parseFloat(savingsPercentage),
            projectedAnnualSavings: parseFloat(projectedAnnualSavings.toFixed(2))
        };
    }
    
    /**
     * ============================================================================
     * UPDATE TEMPLATE LEARNING STATS
     * ============================================================================
     * Called periodically (e.g., end of day) to update template stats
     */
    async updateTemplateLearningStats(templateId) {
        try {
            logger.info('🔄 [COST TRACKING] Updating template learning stats', { templateId });
            
            const template = await GlobalInstantResponseTemplate.findById(templateId);
            if (!template) {
                throw new Error('Template not found');
            }
            
            // Get current month metrics
            const currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
            const metrics = await this.getMonthlyMetrics(templateId, currentMonth);
            
            // Update template stats
            template.learningStats = template.learningStats || {};
            template.learningStats.tier1Percentage = metrics.tierDistribution.tier1.percentage;
            template.learningStats.tier2Percentage = metrics.tierDistribution.tier2.percentage;
            template.learningStats.tier3Percentage = metrics.tierDistribution.tier3.percentage;
            template.learningStats.llmCallsThisMonth = metrics.tierDistribution.tier3.count;
            template.learningStats.llmCostThisMonth = metrics.totalCost;
            template.learningStats.projectedMonthlyCost = metrics.totalCost;
            template.learningStats.averageResponseTime = Math.round(
                (metrics.tierDistribution.tier1.avgResponseTime * metrics.tierDistribution.tier1.count +
                 metrics.tierDistribution.tier2.avgResponseTime * metrics.tierDistribution.tier2.count +
                 metrics.tierDistribution.tier3.avgResponseTime * metrics.tierDistribution.tier3.count) /
                metrics.totalCalls || 0
            );
            
            // Calculate cost savings
            const savings = this.config.baselineMonthlyCost - metrics.totalCost;
            template.learningStats.costSavingsVsBaseline = parseFloat(savings.toFixed(2));
            
            // Calculate self-improvement score
            const weeklyProgression = await this.getWeeklyProgression(templateId);
            const learningMetrics = await this.getLearningMetrics(templateId);
            template.learningStats.selfImprovementScore = this.calculateSelfImprovementScore({
                currentMonthMetrics: metrics,
                weeklyProgression,
                learningMetrics
            });
            
            await template.save();
            
            logger.info('✅ [COST TRACKING] Template stats updated', {
                templateId,
                tier3Percentage: template.learningStats.tier3Percentage,
                monthlyCost: template.learningStats.llmCostThisMonth,
                selfImprovementScore: template.learningStats.selfImprovementScore
            });
            
            return {
                success: true,
                stats: template.learningStats
            };
            
        } catch (error) {
            logger.error('❌ [COST TRACKING] Error updating template stats', {
                templateId,
                error: error.message
            });
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * GET COST PROJECTIONS
     * ============================================================================
     * Forecast future costs based on current trend
     */
    async getCostProjections(templateId, months = 6) {
        try {
            const weeklyProgression = await this.getWeeklyProgression(templateId);
            
            if (weeklyProgression.length < 4) {
                return {
                    success: false,
                    message: 'Not enough data for projections (need 4+ weeks)'
                };
            }
            
            // Calculate trend
            const recentWeeks = weeklyProgression.slice(-8);  // Last 8 weeks
            const avgCostReduction = recentWeeks.reduce((sum, week, i) => {
                if (i === 0) return 0;
                return sum + (recentWeeks[i - 1].totalCost - week.totalCost);
            }, 0) / (recentWeeks.length - 1);
            
            // Project forward
            const currentCost = recentWeeks[recentWeeks.length - 1].totalCost;
            const projections = [];
            
            for (let i = 1; i <= months; i++) {
                const projectedCost = Math.max(this.config.targetMonthlyCost, currentCost - (avgCostReduction * i * 4));
                projections.push({
                    month: i,
                    projectedCost: parseFloat(projectedCost.toFixed(2)),
                    savings: parseFloat((this.config.baselineMonthlyCost - projectedCost).toFixed(2))
                });
            }
            
            return {
                success: true,
                projections,
                avgWeeklyCostReduction: parseFloat(avgCostReduction.toFixed(2)),
                estimatedWeeksToTarget: Math.ceil((currentCost - this.config.targetMonthlyCost) / avgCostReduction)
            };
            
        } catch (error) {
            logger.error('❌ [COST TRACKING] Error getting projections', {
                templateId,
                error: error.message
            });
            throw error;
        }
    }
}

module.exports = new CostTrackingService();

