/**
 * ============================================================================
 * SCENARIO COVERAGE ANALYZER
 * ============================================================================
 * 
 * Analyzes scenario coverage for a company and identifies gaps:
 * - What scenarios are loaded
 * - What customer phrases don't match (from BlackBox logs)
 * - Coverage gaps by category
 * - Recommendations for additional scenarios/templates
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const Company = require('../models/v2Company');
const ScenarioPoolService = require('./ScenarioPoolService');
const BlackBoxLogger = require('./BlackBoxLogger');

class ScenarioCoverageAnalyzer {
    
    /**
     * Analyze scenario coverage for a company
     * 
     * @param {String} companyId - Company ObjectId
     * @param {Object} options - Analysis options
     * @returns {Promise<Object>} Coverage report
     */
    static async analyzeCoverage(companyId, options = {}) {
        const startTime = Date.now();
        
        logger.info('[SCENARIO COVERAGE] Starting analysis', { companyId });
        
        try {
            // ========================================================
            // STEP 1: Load current scenario pool
            // ========================================================
            const { scenarios, templatesUsed } = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
            const enabledScenarios = scenarios.filter(s => s.isEnabledForCompany !== false);
            
            logger.info('[SCENARIO COVERAGE] Scenario pool loaded', {
                total: scenarios.length,
                enabled: enabledScenarios.length,
                templates: templatesUsed.length
            });
            
            // ========================================================
            // STEP 2: Analyze scenario distribution
            // ========================================================
            const distribution = this._analyzeDistribution(enabledScenarios);
            
            // ========================================================
            // STEP 3: Identify coverage gaps
            // ========================================================
            const gaps = this._identifyCoverageGaps(enabledScenarios, distribution);
            
            // ========================================================
            // STEP 4: Analyze recent unmatched phrases (if available)
            // ========================================================
            const unmatchedPhrases = await this._findUnmatchedPhrases(companyId, options.daysBack || 7);
            
            // ========================================================
            // STEP 5: Generate recommendations
            // ========================================================
            const recommendations = this._generateRecommendations(
                enabledScenarios,
                distribution,
                gaps,
                unmatchedPhrases
            );
            
            // ========================================================
            // STEP 6: Calculate coverage score
            // ========================================================
            const coverageScore = this._calculateCoverageScore(
                enabledScenarios,
                distribution,
                gaps,
                unmatchedPhrases
            );
            
            const durationMs = Date.now() - startTime;
            
            logger.info('[SCENARIO COVERAGE] Analysis complete', {
                companyId,
                scenarioCount: enabledScenarios.length,
                coverageScore,
                durationMs
            });
            
            return {
                companyId,
                generatedAt: new Date().toISOString(),
                durationMs,
                
                // Scenario inventory
                inventory: {
                    total: scenarios.length,
                    enabled: enabledScenarios.length,
                    disabled: scenarios.length - enabledScenarios.length,
                    templates: templatesUsed
                },
                
                // Distribution analysis
                distribution,
                
                // Coverage gaps
                gaps,
                
                // Unmatched customer phrases
                unmatchedPhrases,
                
                // Overall score
                coverageScore,
                
                // Actionable recommendations
                recommendations
            };
            
        } catch (error) {
            logger.error('[SCENARIO COVERAGE] Analysis failed', {
                companyId,
                error: error.message
            });
            
            throw error;
        }
    }
    
    /**
     * Analyze scenario distribution across categories
     * 
     * @param {Array} scenarios - Enabled scenarios
     * @returns {Object} Distribution analysis
     * @private
     */
    static _analyzeDistribution(scenarios) {
        const byCategory = {};
        const byTemplate = {};
        const byType = {};
        
        scenarios.forEach(scenario => {
            // By category
            const category = scenario.categoryName || 'Uncategorized';
            if (!byCategory[category]) {
                byCategory[category] = {
                    count: 0,
                    scenarios: []
                };
            }
            byCategory[category].count++;
            byCategory[category].scenarios.push({
                scenarioId: scenario.scenarioId,
                name: scenario.name
            });
            
            // By template
            const template = scenario.templateName || 'Unknown';
            if (!byTemplate[template]) {
                byTemplate[template] = {
                    count: 0,
                    templateId: scenario.templateId
                };
            }
            byTemplate[template].count++;
            
            // By type
            const type = scenario.scenarioType || 'General';
            byType[type] = (byType[type] || 0) + 1;
        });
        
        return {
            byCategory: Object.entries(byCategory)
                .map(([name, data]) => ({ categoryName: name, ...data }))
                .sort((a, b) => b.count - a.count),
            
            byTemplate: Object.entries(byTemplate)
                .map(([name, data]) => ({ templateName: name, ...data }))
                .sort((a, b) => b.count - a.count),
            
            byType: Object.entries(byType)
                .map(([type, count]) => ({ type, count }))
                .sort((a, b) => b.count - a.count)
        };
    }
    
    /**
     * Identify coverage gaps
     * 
     * @param {Array} scenarios - Enabled scenarios
     * @param {Object} distribution - Distribution analysis
     * @returns {Object} Coverage gaps
     * @private
     */
    static _identifyCoverageGaps(scenarios, distribution) {
        const gaps = {
            critical: [],
            high: [],
            medium: []
        };
        
        // Expected categories for service businesses
        const expectedCategories = [
            { name: 'Emergency', minScenarios: 3, priority: 'critical' },
            { name: 'Booking/Scheduling', minScenarios: 5, priority: 'high' },
            { name: 'Service Issues', minScenarios: 8, priority: 'high' },
            { name: 'Pricing/Questions', minScenarios: 5, priority: 'medium' },
            { name: 'Greetings', minScenarios: 3, priority: 'medium' },
            { name: 'Follow-up', minScenarios: 3, priority: 'medium' }
        ];
        
        // Check for missing or under-represented categories
        expectedCategories.forEach(expected => {
            const existing = distribution.byCategory.find(cat => 
                cat.categoryName.toLowerCase().includes(expected.name.toLowerCase())
            );
            
            if (!existing) {
                gaps[expected.priority].push({
                    type: 'missing_category',
                    category: expected.name,
                    message: `No scenarios found for ${expected.name} (recommended: ${expected.minScenarios}+)`,
                    recommendation: `Add ${expected.name} scenarios to cover common customer needs`
                });
            } else if (existing.count < expected.minScenarios) {
                gaps[expected.priority].push({
                    type: 'insufficient_coverage',
                    category: expected.name,
                    current: existing.count,
                    recommended: expected.minScenarios,
                    message: `Only ${existing.count} scenarios for ${expected.name} (recommended: ${expected.minScenarios}+)`,
                    recommendation: `Add ${expected.minScenarios - existing.count} more ${expected.name} scenarios`
                });
            }
        });
        
        // Check overall scenario count
        const totalScenarios = scenarios.length;
        if (totalScenarios < 20) {
            gaps.critical.push({
                type: 'low_total_count',
                current: totalScenarios,
                recommended: 30,
                message: `Only ${totalScenarios} total scenarios (recommended: 30+ for good coverage)`,
                recommendation: 'Link additional templates or create more scenarios in existing templates'
            });
        } else if (totalScenarios < 30) {
            gaps.high.push({
                type: 'below_recommended_count',
                current: totalScenarios,
                recommended: 30,
                message: `${totalScenarios} scenarios loaded (recommended: 30+ for comprehensive coverage)`,
                recommendation: 'Consider adding more scenarios for edge cases and variations'
            });
        }
        
        return gaps;
    }
    
    /**
     * Find unmatched customer phrases from recent calls
     * 
     * @param {String} companyId - Company ObjectId
     * @param {Number} daysBack - Days to look back
     * @returns {Promise<Object>} Unmatched phrases analysis
     * @private
     */
    static async _findUnmatchedPhrases(companyId, daysBack = 7) {
        try {
            if (!BlackBoxLogger || typeof BlackBoxLogger.queryEvents !== 'function') {
                logger.debug('[SCENARIO COVERAGE] BlackBox not available, skipping unmatched phrase analysis');
                return {
                    available: false,
                    phrases: [],
                    llmFallbacks: 0
                };
            }
            
            const since = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
            
            // Query for LLM fallbacks (scenarios didn't match)
            const events = await BlackBoxLogger.queryEvents({
                companyId,
                since,
                types: ['LLM_RESPONSE', 'LLM_FALLBACK_USED', 'SCENARIO_NO_MATCH'],
                limit: 100
            });
            
            // Extract unique user phrases that triggered LLM fallback
            const phrases = new Map();
            
            events.forEach(event => {
                const userInput = event.data?.userInput || event.data?.customerText;
                if (!userInput) return;
                
                const phrase = String(userInput).trim().toLowerCase();
                if (phrase.length < 5 || phrase.length > 200) return; // Filter noise
                
                if (!phrases.has(phrase)) {
                    phrases.set(phrase, {
                        text: userInput,
                        count: 0,
                        firstSeen: event.timestamp,
                        lastSeen: event.timestamp
                    });
                }
                
                const entry = phrases.get(phrase);
                entry.count++;
                entry.lastSeen = event.timestamp;
            });
            
            // Convert to array and sort by frequency
            const phrasesArray = Array.from(phrases.values())
                .sort((a, b) => b.count - a.count)
                .slice(0, 20); // Top 20
            
            return {
                available: true,
                daysAnalyzed: daysBack,
                llmFallbacks: events.length,
                phrases: phrasesArray,
                message: phrasesArray.length > 0
                    ? `Found ${phrasesArray.length} common phrases that don't match existing scenarios`
                    : 'No significant unmatched patterns detected'
            };
            
        } catch (error) {
            logger.warn('[SCENARIO COVERAGE] Failed to analyze unmatched phrases', {
                error: error.message
            });
            
            return {
                available: false,
                error: error.message,
                phrases: [],
                llmFallbacks: 0
            };
        }
    }
    
    /**
     * Generate actionable recommendations
     * 
     * @param {Array} scenarios - Enabled scenarios
     * @param {Object} distribution - Distribution analysis
     * @param {Object} gaps - Coverage gaps
     * @param {Object} unmatchedPhrases - Unmatched phrase analysis
     * @returns {Array} Recommendations
     * @private
     */
    static _generateRecommendations(scenarios, distribution, gaps, unmatchedPhrases) {
        const recommendations = [];
        
        // Critical gaps first
        if (gaps.critical.length > 0) {
            gaps.critical.forEach(gap => {
                recommendations.push({
                    priority: 'CRITICAL',
                    category: gap.category || 'General',
                    action: gap.recommendation,
                    reason: gap.message
                });
            });
        }
        
        // High priority gaps
        if (gaps.high.length > 0) {
            gaps.high.forEach(gap => {
                recommendations.push({
                    priority: 'HIGH',
                    category: gap.category || 'General',
                    action: gap.recommendation,
                    reason: gap.message
                });
            });
        }
        
        // Unmatched phrases suggestions
        if (unmatchedPhrases.available && unmatchedPhrases.phrases.length > 0) {
            const topPhrases = unmatchedPhrases.phrases.slice(0, 5);
            recommendations.push({
                priority: 'HIGH',
                category: 'Coverage Gaps',
                action: `Create scenarios for these common unmatched phrases: ${topPhrases.map(p => `"${p.text}"`).join(', ')}`,
                reason: `These phrases appear ${topPhrases.reduce((sum, p) => sum + p.count, 0)} times but don't match any scenarios`
            });
        }
        
        // Medium priority gaps
        if (gaps.medium.length > 0) {
            gaps.medium.forEach(gap => {
                recommendations.push({
                    priority: 'MEDIUM',
                    category: gap.category || 'General',
                    action: gap.recommendation,
                    reason: gap.message
                });
            });
        }
        
        // Template diversity recommendation
        if (distribution.byTemplate.length === 1 && scenarios.length < 30) {
            recommendations.push({
                priority: 'MEDIUM',
                category: 'Template Diversity',
                action: 'Link additional templates from Global AI Brain',
                reason: `Only 1 template linked. Multiple templates provide better coverage and redundancy.`
            });
        }
        
        // No recommendations = good coverage
        if (recommendations.length === 0) {
            recommendations.push({
                priority: 'INFO',
                category: 'Coverage',
                action: 'Maintain current scenario set',
                reason: 'Scenario coverage appears comprehensive with no significant gaps detected'
            });
        }
        
        return recommendations;
    }
    
    /**
     * Calculate overall coverage score (0-100)
     * 
     * @param {Array} scenarios - Enabled scenarios
     * @param {Object} distribution - Distribution analysis
     * @param {Object} gaps - Coverage gaps
     * @param {Object} unmatchedPhrases - Unmatched phrase analysis
     * @returns {Number} Coverage score
     * @private
     */
    static _calculateCoverageScore(scenarios, distribution, gaps, unmatchedPhrases) {
        let score = 100;
        
        // Deduct for low scenario count
        if (scenarios.length < 10) {
            score -= 40; // Critical
        } else if (scenarios.length < 20) {
            score -= 25; // High
        } else if (scenarios.length < 30) {
            score -= 10; // Medium
        }
        
        // Deduct for gaps
        score -= gaps.critical.length * 15;
        score -= gaps.high.length * 10;
        score -= gaps.medium.length * 5;
        
        // Deduct for unmatched phrases
        if (unmatchedPhrases.available && unmatchedPhrases.llmFallbacks > 0) {
            const fallbackRate = unmatchedPhrases.llmFallbacks / 100; // Normalize
            score -= Math.min(20, fallbackRate * 10);
        }
        
        // Deduct for poor category coverage
        const categoryCount = distribution.byCategory.length;
        if (categoryCount < 5) {
            score -= (5 - categoryCount) * 5;
        }
        
        return Math.max(0, Math.min(100, Math.round(score)));
    }
}

module.exports = ScenarioCoverageAnalyzer;
