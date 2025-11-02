/**
 * ============================================================================
 * TREND ANALYZER - TEMPLATE QUALITY TRACKING
 * ============================================================================
 * 
 * PURPOSE:
 * Tracks how template quality improves over time as suggestions are applied.
 * Provides before/after metrics, confidence trends, tier distribution, and
 * ROI calculations.
 * 
 * METRICS TRACKED:
 * 1. Confidence Trend - Average confidence over last N tests
 * 2. Tier Distribution - % of tests hitting Tier 1/2/3
 * 3. Cost Trend - LLM spending over time
 * 4. Suggestion Impact - Before/after metrics per suggestion
 * 5. Improvement Rate - How fast is template learning
 * 
 * ARCHITECTURE:
 * - Query TestPilotAnalysis for historical data
 * - Calculate rolling averages and trends
 * - Generate before/after comparisons
 * - Project future improvements
 * 
 * CHECKPOINT STRATEGY:
 * - Checkpoint at start of each analysis
 * - Log all database queries
 * - Track calculation performance
 * - Enhanced error messages with context
 * 
 * DEPENDENCIES:
 * - TestPilotAnalysis (historical test data)
 * - GlobalInstantResponseTemplate (template info)
 * 
 * EXPORTS:
 * - TrendAnalyzer (class)
 * 
 * USED BY:
 * - EnterpriseAISuggestionEngine (trend data)
 * - routes/admin/enterpriseSuggestions (trend API)
 * - Frontend trend charts
 * 
 * ============================================================================
 */

const TestPilotAnalysis = require('../models/TestPilotAnalysis');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

class TrendAnalyzer {
    constructor() {
        console.log('🏗️ [CHECKPOINT 0] TrendAnalyzer initialized');
    }
    
    /**
     * ============================================================================
     * GET CONFIDENCE TREND
     * ============================================================================
     * Calculates confidence trend over time periods
     * 
     * @param {String} templateId - Template to analyze
     * @param {Object} options - { period: 'last10' | 'last50' | 'last100' | 'days' }
     * @returns {Object} Trend data with chart points
     * 
     * CHECKPOINT FLOW:
     * 1. Validate inputs
     * 2. Query historical tests
     * 3. Calculate rolling average
     * 4. Identify improvement events
     * 5. Return trend data
     * ============================================================================
     */
    async getConfidenceTrend(templateId, options = {}) {
        console.log('🔵 [CHECKPOINT 1] getConfidenceTrend() started');
        console.log('🔵 [CHECKPOINT 1.1] TemplateId:', templateId, 'Options:', options);
        
        try {
            // ============================================
            // STEP 1: DETERMINE QUERY PARAMETERS
            // ============================================
            const { period = 'last10', days = 30 } = options;
            
            let query = { templateId };
            let limit = 10;
            
            if (period === 'last10') {
                limit = 10;
            } else if (period === 'last50') {
                limit = 50;
            } else if (period === 'last100') {
                limit = 100;
            } else if (period === 'days') {
                const since = new Date();
                since.setDate(since.getDate() - days);
                query.analyzedAt = { $gte: since };
                limit = 1000; // No limit for time-based queries
            }
            
            console.log('✅ [CHECKPOINT 1.2] Query params set:', { period, limit });
            
            // ============================================
            // STEP 2: FETCH HISTORICAL TESTS
            // ============================================
            console.log('🔵 [CHECKPOINT 2] Fetching historical tests...');
            
            const tests = await TestPilotAnalysis.find(query)
                .sort({ analyzedAt: 1 }) // Chronological order
                .limit(limit)
                .select('analyzedAt tierResults.finalConfidence tierResults.finalTier suggestionsSummary')
                .lean();
            
            if (tests.length === 0) {
                console.log('⚠️ [CHECKPOINT 2.1] No historical data found');
                return {
                    dataPoints: [],
                    average: 0,
                    trend: 'INSUFFICIENT_DATA',
                    improvement: 0,
                    message: 'No test data available yet'
                };
            }
            
            console.log('✅ [CHECKPOINT 2.1] Loaded', tests.length, 'historical tests');
            
            // ============================================
            // STEP 3: CALCULATE TREND DATA
            // ============================================
            console.log('🔵 [CHECKPOINT 3] Calculating trend...');
            
            const dataPoints = tests.map(test => ({
                timestamp: test.analyzedAt,
                confidence: test.tierResults.finalConfidence,
                tier: test.tierResults.finalTier
            }));
            
            const average = tests.reduce((sum, t) => sum + t.tierResults.finalConfidence, 0) / tests.length;
            
            // Calculate improvement (first vs last)
            const firstConfidence = tests[0].tierResults.finalConfidence;
            const lastConfidence = tests[tests.length - 1].tierResults.finalConfidence;
            const improvement = lastConfidence - firstConfidence;
            
            // Determine trend direction
            let trend = 'STABLE';
            if (improvement > 0.10) trend = 'IMPROVING';
            else if (improvement > 0.05) trend = 'SLIGHTLY_IMPROVING';
            else if (improvement < -0.10) trend = 'DECLINING';
            else if (improvement < -0.05) trend = 'SLIGHTLY_DECLINING';
            
            console.log('✅ [CHECKPOINT 3.1] Trend calculated:', trend);
            console.log('✅ [CHECKPOINT 3.2] Average confidence:', (average * 100).toFixed(1) + '%');
            console.log('✅ [CHECKPOINT 3.3] Improvement:', (improvement * 100).toFixed(1) + '%');
            
            // ============================================
            // STEP 4: RETURN RESULTS
            // ============================================
            console.log('✅ [CHECKPOINT 4] getConfidenceTrend() complete!');
            
            return {
                dataPoints,
                average,
                trend,
                improvement,
                firstConfidence,
                lastConfidence,
                testCount: tests.length,
                period: period === 'days' ? `${days} days` : period
            };
            
        } catch (error) {
            console.error('❌ [CHECKPOINT ERROR] getConfidenceTrend() failed:', error.message);
            console.error('Stack trace:', error.stack);
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * GET TIER DISTRIBUTION
     * ============================================================================
     * Calculates what % of tests hit each tier
     * 
     * @param {String} templateId - Template to analyze
     * @param {Number} days - Days to look back
     * @returns {Object} Tier distribution percentages
     * ============================================================================
     */
    async getTierDistribution(templateId, days = 30) {
        console.log('🔵 [CHECKPOINT - TIER DIST] getTierDistribution() started');
        
        try {
            const since = new Date();
            since.setDate(since.getDate() - days);
            
            const tests = await TestPilotAnalysis.find({
                templateId,
                analyzedAt: { $gte: since }
            }).select('tierResults.finalTier').lean();
            
            if (tests.length === 0) {
                console.log('⚠️ [CHECKPOINT - TIER DIST] No data');
                return {
                    tier1: 0,
                    tier2: 0,
                    tier3: 0,
                    total: 0
                };
            }
            
            const tier1Count = tests.filter(t => t.tierResults.finalTier === 'tier1').length;
            const tier2Count = tests.filter(t => t.tierResults.finalTier === 'tier2').length;
            const tier3Count = tests.filter(t => t.tierResults.finalTier === 'tier3').length;
            
            const total = tests.length;
            
            console.log('✅ [CHECKPOINT - TIER DIST] Distribution calculated');
            
            return {
                tier1: (tier1Count / total) * 100,
                tier2: (tier2Count / total) * 100,
                tier3: (tier3Count / total) * 100,
                tier1Count,
                tier2Count,
                tier3Count,
                total,
                days
            };
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - TIER DIST ERROR]:', error.message);
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * GET COST TREND
     * ============================================================================
     * Tracks LLM spending over time
     * 
     * @param {String} templateId - Template to analyze
     * @param {Number} days - Days to look back
     * @returns {Object} Cost trend data
     * ============================================================================
     */
    async getCostTrend(templateId, days = 30) {
        console.log('🔵 [CHECKPOINT - COST TREND] getCostTrend() started');
        
        try {
            const since = new Date();
            since.setDate(since.getDate() - days);
            
            const tests = await TestPilotAnalysis.find({
                templateId,
                analyzedAt: { $gte: since }
            }).select('analyzedAt costAnalysis').lean();
            
            if (tests.length === 0) {
                console.log('⚠️ [CHECKPOINT - COST TREND] No data');
                return {
                    totalCost: 0,
                    averageCostPerTest: 0,
                    projectedMonthlyCost: 0,
                    dataPoints: []
                };
            }
            
            const totalCost = tests.reduce((sum, t) => sum + (t.costAnalysis?.analysisCost || 0), 0);
            const averageCostPerTest = totalCost / tests.length;
            
            // Project to 30 days
            const dailyAverage = totalCost / days;
            const projectedMonthlyCost = dailyAverage * 30;
            
            const dataPoints = tests.map(t => ({
                timestamp: t.analyzedAt,
                cost: t.costAnalysis?.analysisCost || 0
            }));
            
            console.log('✅ [CHECKPOINT - COST TREND] Total cost: $' + totalCost.toFixed(2));
            
            return {
                totalCost,
                averageCostPerTest,
                projectedMonthlyCost,
                dataPoints,
                testCount: tests.length,
                days
            };
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - COST TREND ERROR]:', error.message);
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * GET SUGGESTION IMPACT
     * ============================================================================
     * Tracks before/after metrics for applied suggestions
     * 
     * @param {String} templateId - Template to analyze
     * @returns {Object} Suggestion impact data
     * ============================================================================
     */
    async getSuggestionImpact(templateId) {
        console.log('🔵 [CHECKPOINT - SUGGESTION IMPACT] getSuggestionImpact() started');
        
        try {
            // Find all applied suggestions
            const analyses = await TestPilotAnalysis.find({
                templateId,
                'suggestions.status': 'applied'
            }).select('suggestions analyzedAt').lean();
            
            if (analyses.length === 0) {
                console.log('⚠️ [CHECKPOINT - SUGGESTION IMPACT] No applied suggestions');
                return {
                    appliedCount: 0,
                    averageConfidenceGain: 0,
                    averageCostSavings: 0,
                    impacts: []
                };
            }
            
            // Extract applied suggestions
            const appliedSuggestions = [];
            analyses.forEach(analysis => {
                analysis.suggestions?.forEach(suggestion => {
                    if (suggestion.status === 'applied') {
                        appliedSuggestions.push({
                            ...suggestion,
                            appliedDate: analysis.analyzedAt
                        });
                    }
                });
            });
            
            const averageConfidenceGain = appliedSuggestions.reduce(
                (sum, s) => sum + (s.estimatedConfidenceGain || 0), 
                0
            ) / appliedSuggestions.length;
            
            const averageCostSavings = appliedSuggestions.reduce(
                (sum, s) => sum + (s.estimatedDailySavings || 0), 
                0
            ) / appliedSuggestions.length;
            
            console.log('✅ [CHECKPOINT - SUGGESTION IMPACT]', appliedSuggestions.length, 'suggestions applied');
            
            return {
                appliedCount: appliedSuggestions.length,
                averageConfidenceGain,
                averageCostSavings,
                impacts: appliedSuggestions.map(s => ({
                    type: s.type,
                    confidenceGain: s.estimatedConfidenceGain,
                    appliedDate: s.appliedDate
                }))
            };
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - SUGGESTION IMPACT ERROR]:', error.message);
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * GET COMPREHENSIVE TREND REPORT
     * ============================================================================
     * Combines all trend data into single report
     * 
     * @param {String} templateId - Template to analyze
     * @param {Number} days - Days to look back
     * @returns {Object} Complete trend report
     * 
     * CHECKPOINT FLOW:
     * 1. Fetch all trend components in parallel
     * 2. Calculate improvement score
     * 3. Generate recommendations
     * 4. Return comprehensive report
     * ============================================================================
     */
    async getComprehensiveTrendReport(templateId, days = 30) {
        console.log('🔵 [CHECKPOINT - COMPREHENSIVE] getComprehensiveTrendReport() started');
        console.log('🔵 [CHECKPOINT - COMPREHENSIVE 1] TemplateId:', templateId, 'Days:', days);
        
        try {
            // ============================================
            // STEP 1: FETCH ALL TRENDS IN PARALLEL
            // ============================================
            console.log('🔵 [CHECKPOINT - COMPREHENSIVE 2] Fetching all trends...');
            
            const [
                confidenceTrend,
                tierDistribution,
                costTrend,
                suggestionImpact,
                template
            ] = await Promise.all([
                this.getConfidenceTrend(templateId, { period: 'days', days }),
                this.getTierDistribution(templateId, days),
                this.getCostTrend(templateId, days),
                this.getSuggestionImpact(templateId),
                GlobalInstantResponseTemplate.findById(templateId).select('name intelligenceMode').lean()
            ]);
            
            console.log('✅ [CHECKPOINT - COMPREHENSIVE 2.1] All trends fetched');
            
            // ============================================
            // STEP 2: CALCULATE IMPROVEMENT SCORE (0-100)
            // ============================================
            console.log('🔵 [CHECKPOINT - COMPREHENSIVE 3] Calculating improvement score...');
            
            const improvementScore = this.calculateImprovementScore({
                confidenceTrend,
                tierDistribution,
                suggestionImpact
            });
            
            console.log('✅ [CHECKPOINT - COMPREHENSIVE 3.1] Improvement score:', improvementScore);
            
            // ============================================
            // STEP 3: GENERATE RECOMMENDATIONS
            // ============================================
            console.log('🔵 [CHECKPOINT - COMPREHENSIVE 4] Generating recommendations...');
            
            const recommendations = this.generateRecommendations({
                confidenceTrend,
                tierDistribution,
                costTrend,
                suggestionImpact,
                improvementScore
            });
            
            console.log('✅ [CHECKPOINT - COMPREHENSIVE 4.1]', recommendations.length, 'recommendations generated');
            
            // ============================================
            // STEP 4: RETURN COMPLETE REPORT
            // ============================================
            console.log('✅ [CHECKPOINT - COMPREHENSIVE 5] Report complete!');
            
            return {
                templateId,
                templateName: template?.name || 'Unknown',
                intelligenceMode: template?.intelligenceMode || 'MAXIMUM',
                period: `${days} days`,
                generatedAt: new Date(),
                
                // Core metrics
                confidenceTrend,
                tierDistribution,
                costTrend,
                suggestionImpact,
                
                // Summary
                improvementScore,
                recommendations,
                
                // Quick stats
                summary: {
                    averageConfidence: confidenceTrend.average,
                    totalTests: confidenceTrend.testCount,
                    tier1Percentage: tierDistribution.tier1,
                    totalCost: costTrend.totalCost,
                    appliedSuggestions: suggestionImpact.appliedCount,
                    trend: confidenceTrend.trend
                }
            };
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - COMPREHENSIVE ERROR]:', error.message);
            console.error('Stack trace:', error.stack);
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * CALCULATE IMPROVEMENT SCORE (0-100)
     * ============================================================================
     * Overall template quality score
     * 
     * Factors:
     * - Average confidence (40%)
     * - Tier 1 percentage (30%)
     * - Improvement trend (20%)
     * - Suggestions applied (10%)
     * ============================================================================
     */
    calculateImprovementScore(data) {
        const { confidenceTrend, tierDistribution, suggestionImpact } = data;
        
        // Factor 1: Average confidence (40%)
        const confidenceScore = confidenceTrend.average * 40;
        
        // Factor 2: Tier 1 percentage (30%)
        const tier1Score = (tierDistribution.tier1 / 100) * 30;
        
        // Factor 3: Improvement trend (20%)
        let trendScore = 10; // Baseline
        if (confidenceTrend.trend === 'IMPROVING') trendScore = 20;
        else if (confidenceTrend.trend === 'SLIGHTLY_IMPROVING') trendScore = 15;
        else if (confidenceTrend.trend === 'DECLINING') trendScore = 0;
        
        // Factor 4: Suggestions applied (10%)
        const suggestionScore = Math.min(suggestionImpact.appliedCount / 10, 1) * 10;
        
        const totalScore = confidenceScore + tier1Score + trendScore + suggestionScore;
        
        return Math.round(totalScore);
    }
    
    /**
     * ============================================================================
     * GENERATE RECOMMENDATIONS
     * ============================================================================
     * Suggests next steps based on trend data
     * ============================================================================
     */
    generateRecommendations(data) {
        const recommendations = [];
        const { confidenceTrend, tierDistribution, costTrend, suggestionImpact } = data;
        
        // Recommendation 1: Low confidence
        if (confidenceTrend.average < 0.70) {
            recommendations.push({
                type: 'IMPROVE_CONFIDENCE',
                priority: 'HIGH',
                message: 'Average confidence is below 70%. Apply pending suggestions to improve template quality.',
                action: 'Review and apply high-priority suggestions'
            });
        }
        
        // Recommendation 2: Too much Tier 3 usage
        if (tierDistribution.tier3 > 30) {
            recommendations.push({
                type: 'REDUCE_LLM_USAGE',
                priority: 'HIGH',
                message: `${tierDistribution.tier3.toFixed(0)}% of tests use expensive Tier 3 (LLM). Add more triggers/fillers to shift to Tier 1.`,
                action: 'Apply missing trigger suggestions'
            });
        }
        
        // Recommendation 3: Declining trend
        if (confidenceTrend.trend === 'DECLINING' || confidenceTrend.trend === 'SLIGHTLY_DECLINING') {
            recommendations.push({
                type: 'INVESTIGATE_DECLINE',
                priority: 'CRITICAL',
                message: 'Template quality is declining. Review recent changes and test for conflicts.',
                action: 'Run conflict detection and review recent edits'
            });
        }
        
        // Recommendation 4: High costs
        if (costTrend.projectedMonthlyCost > 50) {
            recommendations.push({
                type: 'REDUCE_COSTS',
                priority: 'MEDIUM',
                message: `Projected monthly cost: $${costTrend.projectedMonthlyCost.toFixed(2)}. Improve template to reduce LLM usage.`,
                action: 'Apply suggestions to shift tests from Tier 3 to Tier 1'
            });
        }
        
        // Recommendation 5: Low suggestion application rate
        if (suggestionImpact.appliedCount < 5 && confidenceTrend.testCount > 20) {
            recommendations.push({
                type: 'APPLY_SUGGESTIONS',
                priority: 'MEDIUM',
                message: 'Only ' + suggestionImpact.appliedCount + ' suggestions applied. Review pending suggestions to improve faster.',
                action: 'Review and apply pending suggestions'
            });
        }
        
        // Recommendation 6: Excellent performance
        if (confidenceTrend.average >= 0.90 && tierDistribution.tier1 >= 80) {
            recommendations.push({
                type: 'EXCELLENT_PERFORMANCE',
                priority: 'INFO',
                message: 'Template is performing excellently! Consider switching to MINIMAL intelligence mode to reduce testing costs.',
                action: 'Switch intelligence mode from MAXIMUM to MINIMAL'
            });
        }
        
        return recommendations;
    }
}

module.exports = TrendAnalyzer;

