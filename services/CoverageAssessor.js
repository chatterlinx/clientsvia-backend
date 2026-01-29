/**
 * ════════════════════════════════════════════════════════════════════════════════
 * COVERAGE ASSESSOR - Measures intent coverage for a company's template
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * Assess how well a company's scenarios cover the required intents from the blueprint.
 * Returns actionable results: Good / Weak / Missing / Skipped
 * 
 * COVERAGE STATUS:
 * - GOOD: Intent is covered by a scenario with audit score >= 8
 * - WEAK: Intent is covered but scenario scored 5-7 (needs improvement)
 * - MISSING: No scenario maps to this intent
 * - SKIPPED: Intent has serviceKey that's disabled for this company
 * - NEEDS_REVIEW: Intent is covered but has no audit score yet
 * 
 * USAGE:
 * ```js
 * const assessor = new CoverageAssessor(blueprintSpec);
 * const result = await assessor.assess(companyId);
 * // result.summary: { good: 45, weak: 12, missing: 18, skipped: 5 }
 * // result.intents: [{ itemKey, status, scenario?, score? }]
 * ```
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const IntentMatcher = require('./IntentMatcher');
const logger = require('../utils/logger');

// Models
const Company = require('../models/v2Company');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

class CoverageAssessor {
    constructor(blueprintSpec) {
        this.blueprint = blueprintSpec;
        this.matcher = new IntentMatcher(blueprintSpec);
    }
    
    /**
     * Assess coverage for a company
     * 
     * @param {String} companyId - Company ObjectId
     * @param {Object} options - Assessment options
     * @returns {Object} - Coverage assessment result
     */
    async assess(companyId, options = {}) {
        const startTime = Date.now();
        
        try {
            // ════════════════════════════════════════════════════════════════════
            // STEP 1: Load company and template data
            // ════════════════════════════════════════════════════════════════════
            const company = await Company.findById(companyId)
                .select('aiAgentSettings.templateReferences aiAgentSettings.customTemplateId aiAgentSettings.services companyName businessName')
                .lean();
            
            if (!company) {
                return { error: 'Company not found', companyId };
            }
            
            const companyServices = company.aiAgentSettings?.services || {};
            
            // Get template(s)
            const templateRefs = company.aiAgentSettings?.templateReferences || [];
            const customTemplateId = company.aiAgentSettings?.customTemplateId;
            
            // Load scenarios from all templates
            const scenarios = await this._loadAllScenarios(templateRefs, customTemplateId);
            
            if (scenarios.length === 0) {
                return {
                    error: 'No scenarios found',
                    companyId,
                    companyName: company.companyName || company.businessName
                };
            }
            
            // ════════════════════════════════════════════════════════════════════
            // STEP 2: Get assessable intents (respecting service toggles)
            // ════════════════════════════════════════════════════════════════════
            const assessableIntents = this.matcher.getAssessableIntents(companyServices);
            const skippedIntents = this.matcher.getSkippedIntents(companyServices);
            
            // ════════════════════════════════════════════════════════════════════
            // STEP 3: Match scenarios to intents
            // ════════════════════════════════════════════════════════════════════
            const matchResult = this.matcher.matchAll(scenarios, {
                minConfidence: options.minConfidence || 0.3
            });
            
            // ════════════════════════════════════════════════════════════════════
            // STEP 4: Load audit scores (if available)
            // ════════════════════════════════════════════════════════════════════
            const auditScores = options.auditScores || {}; // { scenarioId: score }
            
            // ════════════════════════════════════════════════════════════════════
            // STEP 5: Classify each assessable intent
            // ════════════════════════════════════════════════════════════════════
            const intentStatuses = [];
            const summary = {
                total: assessableIntents.length,
                good: 0,
                weak: 0,
                missing: 0,
                needsReview: 0,
                skipped: skippedIntents.length
            };
            
            for (const intent of assessableIntents) {
                const matchedEntry = matchResult.byIntent.get(intent.itemKey);
                
                let status, scenario = null, score = null, confidence = null;
                
                if (!matchedEntry) {
                    // No scenario covers this intent
                    status = 'MISSING';
                    summary.missing++;
                } else {
                    scenario = {
                        scenarioId: matchedEntry.scenarioId,
                        scenarioName: matchedEntry.scenarioName,
                        categoryName: matchedEntry.categoryName
                    };
                    confidence = matchedEntry.confidence;
                    score = auditScores[matchedEntry.scenarioId] ?? null;
                    
                    if (score === null) {
                        status = 'NEEDS_REVIEW';
                        summary.needsReview++;
                    } else if (score >= 8) {
                        status = 'GOOD';
                        summary.good++;
                    } else if (score >= 5) {
                        status = 'WEAK';
                        summary.weak++;
                    } else {
                        // Score < 5 is essentially missing (scenario is broken)
                        status = 'WEAK';
                        summary.weak++;
                    }
                }
                
                intentStatuses.push({
                    itemKey: intent.itemKey,
                    itemName: intent.name,
                    categoryKey: intent.categoryKey,
                    categoryName: intent.categoryName,
                    required: intent.required,
                    serviceKey: intent.serviceKey || null,
                    status,
                    scenario,
                    score,
                    matchConfidence: confidence
                });
            }
            
            // Add skipped intents
            for (const intent of skippedIntents) {
                intentStatuses.push({
                    itemKey: intent.itemKey,
                    itemName: intent.name,
                    categoryKey: intent.categoryKey,
                    categoryName: intent.categoryName,
                    required: intent.required,
                    serviceKey: intent.serviceKey,
                    status: 'SKIPPED',
                    scenario: null,
                    score: null,
                    matchConfidence: null,
                    skipReason: `Service '${intent.serviceKey}' is disabled`
                });
            }
            
            // ════════════════════════════════════════════════════════════════════
            // STEP 6: Calculate coverage percentage
            // ════════════════════════════════════════════════════════════════════
            const coveredCount = summary.good + summary.weak + summary.needsReview;
            const coveragePercent = Math.round((coveredCount / summary.total) * 100);
            const healthyPercent = Math.round((summary.good / summary.total) * 100);
            
            // ════════════════════════════════════════════════════════════════════
            // STEP 7: Build actionable recommendations
            // ════════════════════════════════════════════════════════════════════
            const recommendations = this._buildRecommendations(intentStatuses, summary);
            
            return {
                success: true,
                companyId,
                companyName: company.companyName || company.businessName,
                blueprintId: this.blueprint.blueprintId,
                blueprintName: this.blueprint.name,
                
                // Summary
                summary,
                coveragePercent,
                healthyPercent,
                
                // Detailed status per intent
                intents: intentStatuses,
                
                // Grouped by status for easy UI rendering
                byStatus: {
                    good: intentStatuses.filter(i => i.status === 'GOOD'),
                    weak: intentStatuses.filter(i => i.status === 'WEAK'),
                    missing: intentStatuses.filter(i => i.status === 'MISSING'),
                    needsReview: intentStatuses.filter(i => i.status === 'NEEDS_REVIEW'),
                    skipped: intentStatuses.filter(i => i.status === 'SKIPPED')
                },
                
                // Unmatched scenarios (scenarios that don't map to any blueprint intent)
                unmatchedScenarios: matchResult.unmatched,
                
                // Recommendations
                recommendations,
                
                // Metadata
                scenariosAnalyzed: scenarios.length,
                processingTimeMs: Date.now() - startTime
            };
            
        } catch (error) {
            logger.error('[COVERAGE ASSESSOR] Error', { companyId, error: error.message });
            return {
                error: 'Assessment failed',
                details: error.message,
                companyId
            };
        }
    }
    
    /**
     * Load all scenarios from template references
     */
    async _loadAllScenarios(templateRefs, customTemplateId) {
        const scenarios = [];
        const templateIds = new Set();
        
        // Add main template IDs
        for (const ref of templateRefs) {
            if (ref.templateId && ref.enabled !== false) {
                templateIds.add(ref.templateId);
            }
        }
        
        // Add custom template ID
        if (customTemplateId) {
            templateIds.add(customTemplateId);
        }
        
        // Load templates
        const templates = await GlobalInstantResponseTemplate.find({
            _id: { $in: Array.from(templateIds) }
        }).lean();
        
        // Flatten scenarios
        for (const template of templates) {
            const isCustom = template._id.toString() === customTemplateId;
            
            for (const category of (template.categories || [])) {
                for (const scenario of (category.scenarios || [])) {
                    if (scenario.isActive !== false) {
                        scenarios.push({
                            ...scenario,
                            scenarioId: scenario.scenarioId || scenario._id?.toString(),
                            categoryName: category.name,
                            categoryId: category.id || category._id?.toString(),
                            templateId: template._id.toString(),
                            isCompanyLocal: isCustom
                        });
                    }
                }
            }
        }
        
        return scenarios;
    }
    
    /**
     * Build actionable recommendations based on coverage
     */
    _buildRecommendations(intentStatuses, summary) {
        const recommendations = [];
        
        // Priority 1: Missing required intents
        const missingRequired = intentStatuses.filter(i => 
            i.status === 'MISSING' && i.required
        );
        if (missingRequired.length > 0) {
            recommendations.push({
                priority: 'HIGH',
                type: 'MISSING_REQUIRED',
                message: `${missingRequired.length} required intents are missing`,
                action: 'Generate scenarios for these intents',
                intents: missingRequired.map(i => i.itemKey)
            });
        }
        
        // Priority 2: Weak required intents
        const weakRequired = intentStatuses.filter(i => 
            i.status === 'WEAK' && i.required
        );
        if (weakRequired.length > 0) {
            recommendations.push({
                priority: 'HIGH',
                type: 'WEAK_REQUIRED',
                message: `${weakRequired.length} required intents have weak scenarios`,
                action: 'Replace or improve these scenarios',
                intents: weakRequired.map(i => i.itemKey)
            });
        }
        
        // Priority 3: Missing optional intents
        const missingOptional = intentStatuses.filter(i => 
            i.status === 'MISSING' && !i.required && !i.serviceKey
        );
        if (missingOptional.length > 0) {
            recommendations.push({
                priority: 'MEDIUM',
                type: 'MISSING_OPTIONAL',
                message: `${missingOptional.length} optional intents could be added`,
                action: 'Consider generating scenarios for better coverage',
                intents: missingOptional.map(i => i.itemKey)
            });
        }
        
        // Priority 4: Needs review
        if (summary.needsReview > 0) {
            recommendations.push({
                priority: 'LOW',
                type: 'NEEDS_AUDIT',
                message: `${summary.needsReview} intents need audit review`,
                action: 'Run Deep Audit to get quality scores',
                intents: intentStatuses.filter(i => i.status === 'NEEDS_REVIEW').map(i => i.itemKey)
            });
        }
        
        return recommendations;
    }
}

module.exports = CoverageAssessor;
