/**
 * ============================================================================
 * COST IMPACT CALCULATOR - ROI & SAVINGS PROJECTIONS
 * ============================================================================
 * 
 * PURPOSE:
 * Calculates the financial impact of applying LLM suggestions. Provides
 * ROI projections, payback period, and cost-benefit analysis to justify
 * Test Pilot investment.
 * 
 * CALCULATIONS:
 * 1. Per-Pattern Cost - How much does this pattern cost in production?
 * 2. Tier Shift Savings - Savings from moving Tier 3 → Tier 1
 * 3. Volume Projection - Estimated call volume impact
 * 4. Payback Period - Days until ROI is positive
 * 5. Monthly Savings - Projected monthly cost reduction
 * 
 * PHILOSOPHY:
 * Test Pilot: "Pay $0.10 now to save $0.50/day forever"
 * 
 * ARCHITECTURE:
 * - Pricing constants for all LLM models
 * - Statistical call volume estimation
 * - Conservative projections (under-promise, over-deliver)
 * - What-if scenario modeling
 * 
 * CHECKPOINT STRATEGY:
 * - Log all cost calculations with breakdown
 * - Track assumptions and estimates
 * - Provide confidence levels for projections
 * 
 * DEPENDENCIES:
 * - TestPilotAnalysis (historical cost data)
 * - TrendAnalyzer (call volume trends)
 * 
 * EXPORTS:
 * - CostImpactCalculator (class)
 * 
 * USED BY:
 * - EnterpriseAISuggestionEngine (cost projections)
 * - routes/admin/enterpriseSuggestions (cost API)
 * - Frontend cost dashboard
 * 
 * ============================================================================
 */

const TestPilotAnalysis = require('../models/TestPilotAnalysis');

class CostImpactCalculator {
    constructor() {
        console.log('🏗️ [CHECKPOINT 0] CostImpactCalculator initialized');
        
        // ============================================
        // PRICING CONSTANTS (per call)
        // ============================================
        this.pricing = {
            tier1: 0.00,      // Free (rule-based)
            tier2: 0.00,      // Free (semantic)
            tier3: 0.50,      // Expensive (LLM - gpt-4o-mini in production)
        };
        
        // ============================================
        // CALL VOLUME ESTIMATES (conservative)
        // ============================================
        this.callVolumeEstimates = {
            low: 50,          // Small business
            medium: 100,      // Medium business
            high: 500,        // Large business
            enterprise: 2000  // Enterprise
        };
    }
    
    /**
     * ============================================================================
     * CALCULATE PER-PATTERN COST
     * ============================================================================
     * Estimates how much a specific pattern costs in production
     * 
     * @param {Object} pattern - Pattern data (frequency, tier, etc.)
     * @param {String} volumeProfile - 'low' | 'medium' | 'high' | 'enterprise'
     * @returns {Object} Cost breakdown
     * 
     * CHECKPOINT FLOW:
     * 1. Determine pattern frequency
     * 2. Estimate affected calls per day
     * 3. Calculate current cost (if using Tier 3)
     * 4. Calculate future cost (if fixed with Tier 1)
     * 5. Calculate savings
     * ============================================================================
     */
    calculatePerPatternCost(pattern, volumeProfile = 'medium') {
        console.log('🔵 [CHECKPOINT 1] calculatePerPatternCost() started');
        console.log('🔵 [CHECKPOINT 1.1] Pattern:', pattern.pattern, 'Volume:', volumeProfile);
        
        try {
            // ============================================
            // STEP 1: ESTIMATE CALL VOLUME
            // ============================================
            const callsPerDay = this.callVolumeEstimates[volumeProfile] || this.callVolumeEstimates.medium;
            
            console.log('✅ [CHECKPOINT 1.2] Estimated calls per day:', callsPerDay);
            
            // ============================================
            // STEP 2: CALCULATE AFFECTED CALLS
            // ============================================
            // How many calls per day contain this pattern?
            const affectedCallsPerDay = callsPerDay * (pattern.frequency || 0.10);
            
            console.log('✅ [CHECKPOINT 1.3] Affected calls per day:', affectedCallsPerDay.toFixed(0));
            
            // ============================================
            // STEP 3: CURRENT COST (Tier 3)
            // ============================================
            // If not fixed, these calls use expensive Tier 3
            const currentCostPerDay = affectedCallsPerDay * this.pricing.tier3;
            const currentCostPerMonth = currentCostPerDay * 30;
            const currentCostPerYear = currentCostPerDay * 365;
            
            console.log('✅ [CHECKPOINT 1.4] Current monthly cost: $' + currentCostPerMonth.toFixed(2));
            
            // ============================================
            // STEP 4: FUTURE COST (Tier 1 - FREE!)
            // ============================================
            const futureCostPerDay = affectedCallsPerDay * this.pricing.tier1; // $0
            const futureCostPerMonth = futureCostPerDay * 30;
            const futureCostPerYear = futureCostPerDay * 365;
            
            // ============================================
            // STEP 5: SAVINGS
            // ============================================
            const savingsPerDay = currentCostPerDay - futureCostPerDay;
            const savingsPerMonth = currentCostPerMonth - futureCostPerMonth;
            const savingsPerYear = currentCostPerYear - futureCostPerYear;
            
            console.log('✅ [CHECKPOINT 1.5] Monthly savings: $' + savingsPerMonth.toFixed(2));
            
            // ============================================
            // STEP 6: RETURN RESULTS
            // ============================================
            console.log('✅ [CHECKPOINT 2] calculatePerPatternCost() complete!');
            
            return {
                pattern: pattern.pattern,
                frequency: pattern.frequency,
                volumeProfile,
                callsPerDay,
                affectedCallsPerDay: Math.round(affectedCallsPerDay),
                
                current: {
                    tier: 'tier3',
                    costPerCall: this.pricing.tier3,
                    costPerDay: currentCostPerDay,
                    costPerMonth: currentCostPerMonth,
                    costPerYear: currentCostPerYear
                },
                
                future: {
                    tier: 'tier1',
                    costPerCall: this.pricing.tier1,
                    costPerDay: futureCostPerDay,
                    costPerMonth: futureCostPerMonth,
                    costPerYear: futureCostPerYear
                },
                
                savings: {
                    perDay: savingsPerDay,
                    perMonth: savingsPerMonth,
                    perYear: savingsPerYear
                }
            };
            
        } catch (error) {
            console.error('❌ [CHECKPOINT ERROR] calculatePerPatternCost() failed:', error.message);
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * CALCULATE ROI FOR SUGGESTION
     * ============================================================================
     * Calculates return on investment for applying a suggestion
     * 
     * @param {Object} suggestion - Suggestion data
     * @param {Number} analysisCost - Cost of the analysis that found this
     * @param {String} volumeProfile - Call volume profile
     * @returns {Object} ROI breakdown
     * ============================================================================
     */
    calculateSuggestionROI(suggestion, analysisCost = 0.10, volumeProfile = 'medium') {
        console.log('🔵 [CHECKPOINT - ROI] calculateSuggestionROI() started');
        
        try {
            // Get cost impact
            const costImpact = this.calculatePerPatternCost(
                {
                    pattern: suggestion.suggestedWords?.join(' ') || 'unknown',
                    frequency: suggestion.patternFrequency || 0.10
                },
                volumeProfile
            );
            
            // Calculate payback period
            const dailySavings = costImpact.savings.perDay;
            const paybackDays = dailySavings > 0 ? analysisCost / dailySavings : 999;
            
            // Calculate ROI (first month)
            const monthlySavings = costImpact.savings.perMonth;
            const roi = monthlySavings > 0 ? (monthlySavings / analysisCost) : 0;
            
            console.log('✅ [CHECKPOINT - ROI] Payback days:', paybackDays.toFixed(1));
            console.log('✅ [CHECKPOINT - ROI] Monthly ROI:', (roi * 100).toFixed(0) + '%');
            
            return {
                analysisCost,
                monthlySavings,
                yearlyS avings: costImpact.savings.perYear,
                paybackDays: Math.min(paybackDays, 365),
                roi,
                roiPercentage: roi * 100,
                costImpact,
                
                // Investment grade
                grade: this.calculateROIGrade(paybackDays, roi)
            };
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - ROI ERROR]:', error.message);
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * CALCULATE BULK ROI
     * ============================================================================
     * ROI for applying multiple suggestions at once
     * 
     * @param {Array} suggestions - Array of suggestions
     * @param {Number} totalAnalysisCost - Total cost of all analyses
     * @param {String} volumeProfile - Call volume profile
     * @returns {Object} Aggregated ROI
     * ============================================================================
     */
    calculateBulkROI(suggestions, totalAnalysisCost, volumeProfile = 'medium') {
        console.log('🔵 [CHECKPOINT - BULK ROI] calculateBulkROI() started');
        console.log('🔵 [CHECKPOINT - BULK ROI 1]', suggestions.length, 'suggestions');
        
        try {
            const individualROIs = suggestions.map(suggestion => 
                this.calculateSuggestionROI(suggestion, 0, volumeProfile) // 0 = don't double-count analysis cost
            );
            
            const totalMonthlySavings = individualROIs.reduce((sum, roi) => sum + roi.monthlySavings, 0);
            const totalYearlySavings = individualROIs.reduce((sum, roi) => sum + roi.yearlySavings, 0);
            
            const paybackDays = totalMonthlySavings > 0 ? 
                (totalAnalysisCost / (totalMonthlySavings / 30)) : 999;
            
            const roi = totalMonthlySavings > 0 ? 
                (totalMonthlySavings / totalAnalysisCost) : 0;
            
            console.log('✅ [CHECKPOINT - BULK ROI 2] Total monthly savings: $' + totalMonthlySavings.toFixed(2));
            console.log('✅ [CHECKPOINT - BULK ROI 3] Bulk ROI:', (roi * 100).toFixed(0) + '%');
            
            return {
                suggestionCount: suggestions.length,
                totalAnalysisCost,
                totalMonthlySavings,
                totalYearlySavings,
                paybackDays: Math.min(paybackDays, 365),
                roi,
                roiPercentage: roi * 100,
                individualROIs,
                grade: this.calculateROIGrade(paybackDays, roi)
            };
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - BULK ROI ERROR]:', error.message);
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * PROJECT COST SAVINGS (Historical)
     * ============================================================================
     * Projects savings based on historical pattern data
     * 
     * @param {String} templateId - Template to analyze
     * @param {Number} days - Days to look back
     * @param {String} volumeProfile - Call volume profile
     * @returns {Object} Projected savings
     * ============================================================================
     */
    async projectCostSavings(templateId, days = 30, volumeProfile = 'medium') {
        console.log('🔵 [CHECKPOINT - PROJECT] projectCostSavings() started');
        
        try {
            // Get historical tests
            const since = new Date();
            since.setDate(since.getDate() - days);
            
            const analyses = await TestPilotAnalysis.find({
                templateId,
                analyzedAt: { $gte: since }
            }).select('tierResults costAnalysis suggestions').lean();
            
            if (analyses.length === 0) {
                console.log('⚠️ [CHECKPOINT - PROJECT] No historical data');
                return {
                    projectedMonthlySavings: 0,
                    currentMonthlyCost: 0,
                    futureMonthlyCost: 0,
                    confidence: 'LOW',
                    message: 'Insufficient data for projection'
                };
            }
            
            // Calculate current Tier 3 usage
            const tier3Count = analyses.filter(a => a.tierResults.finalTier === 'tier3').length;
            const tier3Percentage = tier3Count / analyses.length;
            
            // Estimate production impact
            const callsPerDay = this.callVolumeEstimates[volumeProfile];
            const tier3CallsPerDay = callsPerDay * tier3Percentage;
            
            const currentMonthlyCost = tier3CallsPerDay * this.pricing.tier3 * 30;
            
            // If all suggestions were applied (shift to Tier 1)
            const futureMonthlyCost = 0; // All would be Tier 1 (free)
            
            const projectedMonthlySavings = currentMonthlyCost - futureMonthlyCost;
            
            console.log('✅ [CHECKPOINT - PROJECT] Projected monthly savings: $' + projectedMonthlySavings.toFixed(2));
            
            return {
                projectedMonthlySavings,
                currentMonthlyCost,
                futureMonthlyCost,
                tier3Percentage: tier3Percentage * 100,
                callsPerDay,
                tier3CallsPerDay: Math.round(tier3CallsPerDay),
                confidence: analyses.length >= 50 ? 'HIGH' : analyses.length >= 20 ? 'MEDIUM' : 'LOW',
                basedOnTests: analyses.length,
                timeframe: `${days} days`
            };
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - PROJECT ERROR]:', error.message);
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * CALCULATE ROI GRADE
     * ============================================================================
     * Grades the investment quality
     * 
     * @param {Number} paybackDays - Days to break even
     * @param {Number} roi - ROI multiplier
     * @returns {String} Grade (A+ to F)
     * ============================================================================
     */
    calculateROIGrade(paybackDays, roi) {
        // Instant payback + high ROI
        if (paybackDays <= 1 && roi >= 100) return 'A+';
        
        // Very fast payback
        if (paybackDays <= 7 && roi >= 10) return 'A';
        
        // Fast payback
        if (paybackDays <= 30 && roi >= 5) return 'B+';
        
        // Reasonable payback
        if (paybackDays <= 60 && roi >= 2) return 'B';
        
        // Slow payback
        if (paybackDays <= 90 && roi >= 1) return 'C';
        
        // Very slow
        if (paybackDays <= 180) return 'D';
        
        // Poor investment
        return 'F';
    }
    
    /**
     * ============================================================================
     * ESTIMATE CALL VOLUME FROM HISTORICAL DATA
     * ============================================================================
     * Estimates production call volume based on test frequency
     * 
     * @param {String} templateId - Template to analyze
     * @param {Number} days - Days to look back
     * @returns {Object} Volume estimate
     * ============================================================================
     */
    async estimateCallVolume(templateId, days = 7) {
        console.log('🔵 [CHECKPOINT - VOLUME] estimateCallVolume() started');
        
        try {
            const since = new Date();
            since.setDate(since.getDate() - days);
            
            const testCount = await TestPilotAnalysis.countDocuments({
                templateId,
                analyzedAt: { $gte: since }
            });
            
            const testsPerDay = testCount / days;
            
            // Heuristic: Production volume is typically 10-50x test volume
            // Conservative estimate: use 10x
            const estimatedCallsPerDay = testsPerDay * 10;
            
            // Classify volume profile
            let profile = 'low';
            if (estimatedCallsPerDay >= 2000) profile = 'enterprise';
            else if (estimatedCallsPerDay >= 500) profile = 'high';
            else if (estimatedCallsPerDay >= 100) profile = 'medium';
            
            console.log('✅ [CHECKPOINT - VOLUME] Estimated calls per day:', Math.round(estimatedCallsPerDay));
            console.log('✅ [CHECKPOINT - VOLUME] Volume profile:', profile);
            
            return {
                testsPerDay,
                estimatedCallsPerDay: Math.round(estimatedCallsPerDay),
                profile,
                confidence: testCount >= 20 ? 'MEDIUM' : 'LOW',
                basedOnTests: testCount,
                timeframe: `${days} days`
            };
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - VOLUME ERROR]:', error.message);
            return {
                testsPerDay: 0,
                estimatedCallsPerDay: this.callVolumeEstimates.medium, // Default
                profile: 'medium',
                confidence: 'LOW',
                basedOnTests: 0
            };
        }
    }
    
    /**
     * ============================================================================
     * GENERATE COST REPORT
     * ============================================================================
     * Comprehensive cost analysis report
     * 
     * @param {String} templateId - Template to analyze
     * @param {Array} suggestions - Pending suggestions
     * @param {Number} analysisCost - Total analysis cost
     * @returns {Object} Complete cost report
     * ============================================================================
     */
    async generateCostReport(templateId, suggestions, analysisCost) {
        console.log('🔵 [CHECKPOINT - REPORT] generateCostReport() started');
        
        try {
            // Estimate call volume
            const volumeEstimate = await this.estimateCallVolume(templateId);
            
            // Calculate bulk ROI
            const bulkROI = this.calculateBulkROI(
                suggestions,
                analysisCost,
                volumeEstimate.profile
            );
            
            // Project savings
            const projection = await this.projectCostSavings(
                templateId,
                30,
                volumeEstimate.profile
            );
            
            console.log('✅ [CHECKPOINT - REPORT] Report generated');
            
            return {
                templateId,
                generatedAt: new Date(),
                volumeEstimate,
                bulkROI,
                projection,
                summary: {
                    investmentCost: analysisCost,
                    monthlyReturn: bulkROI.totalMonthlySavings,
                    paybackDays: bulkROI.paybackDays,
                    roiGrade: bulkROI.grade,
                    recommendation: this.generateRecommendation(bulkROI)
                }
            };
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - REPORT ERROR]:', error.message);
            throw error;
        }
    }
    
    /**
     * Generate investment recommendation
     */
    generateRecommendation(bulkROI) {
        const grade = bulkROI.grade;
        const payback = bulkROI.paybackDays;
        const savings = bulkROI.totalMonthlySavings;
        
        if (grade === 'A+' || grade === 'A') {
            return {
                action: 'APPLY_IMMEDIATELY',
                message: `Excellent ROI! Payback in ${payback.toFixed(0)} days, saving $${savings.toFixed(2)}/month. Apply all suggestions now.`,
                priority: 'HIGH'
            };
        } else if (grade === 'B+' || grade === 'B') {
            return {
                action: 'APPLY_SOON',
                message: `Good ROI. Payback in ${payback.toFixed(0)} days. Review and apply high-priority suggestions.`,
                priority: 'MEDIUM'
            };
        } else if (grade === 'C') {
            return {
                action: 'REVIEW_CAREFULLY',
                message: `Moderate ROI. Review suggestions carefully before applying.`,
                priority: 'LOW'
            };
        } else {
            return {
                action: 'RECONSIDER',
                message: `Low ROI. Consider testing more before applying suggestions.`,
                priority: 'LOW'
            };
        }
    }
}

module.exports = CostImpactCalculator;

