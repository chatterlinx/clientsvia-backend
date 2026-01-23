/**
 * AuditEngine - Orchestrates scenario auditing
 * 
 * Runs audit rules against scenarios and produces a comprehensive report.
 * 
 * USAGE:
 * 
 *   const { AuditEngine } = require('./services/scenarioAudit');
 *   const engine = new AuditEngine();
 *   
 *   // Audit single scenario
 *   const result = await engine.auditScenario(scenario);
 *   
 *   // Audit all scenarios in a template
 *   const report = await engine.auditTemplate(template);
 *   
 *   // Audit with specific rules only
 *   const result = await engine.auditScenario(scenario, {
 *       rules: ['banned-phrases', 'personalization']
 *   });
 * 
 * OUTPUT FORMAT:
 * {
 *   summary: {
 *     totalScenarios: 73,
 *     scenariosWithViolations: 12,
 *     totalViolations: 45,
 *     byCategory: { tone: 20, structure: 15, ... },
 *     bySeverity: { error: 5, warning: 30, info: 10 }
 *   },
 *   scenarios: [
 *     {
 *       scenarioId: '...',
 *       name: '...',
 *       violations: [...],
 *       passedRules: [...]
 *     }
 *   ],
 *   timestamp: '2026-01-23T...',
 *   duration: 245
 * }
 */

const { 
    getAllRules, 
    getRuleById, 
    getDeterministicRules,
    getAllRuleMetadata 
} = require('./rules');
const { SEVERITY, RULE_CATEGORIES } = require('./constants');

class AuditEngine {
    constructor(options = {}) {
        this.rules = options.rules || getAllRules();
        this.logger = options.logger || console;
    }
    
    /**
     * Audit a single scenario
     * 
     * @param {Object} scenario - The scenario to audit
     * @param {Object} options - Audit options
     * @param {string[]} options.rules - Specific rule IDs to run (default: all)
     * @param {Object} options.context - Additional context (template, allScenarios, etc.)
     * @returns {Object} Audit result for this scenario
     */
    async auditScenario(scenario, options = {}) {
        const startTime = Date.now();
        
        // Determine which rules to run
        let rulesToRun = this.rules;
        if (options.rules && options.rules.length > 0) {
            rulesToRun = options.rules
                .map(ruleId => getRuleById(ruleId))
                .filter(Boolean);
        }
        
        // Run all rules
        const violations = [];
        const passedRules = [];
        
        for (const rule of rulesToRun) {
            try {
                const ruleViolations = await rule.check(scenario, options.context || {});
                
                if (ruleViolations.length > 0) {
                    violations.push(...ruleViolations);
                } else {
                    passedRules.push(rule.id);
                }
            } catch (error) {
                this.logger.error(`[AUDIT] Rule ${rule.id} failed:`, error.message);
                violations.push({
                    ruleId: rule.id,
                    ruleName: rule.name,
                    severity: SEVERITY.ERROR,
                    category: rule.category,
                    field: '_audit_error',
                    message: `Rule execution failed: ${error.message}`,
                    suggestion: 'Check scenario data format'
                });
            }
        }
        
        return {
            scenarioId: scenario.scenarioId || scenario._id,
            name: scenario.name,
            scenarioType: scenario.scenarioType,
            category: scenario.categories?.[0] || scenario.category,
            violations,
            passedRules,
            violationCount: violations.length,
            hasErrors: violations.some(v => v.severity === SEVERITY.ERROR),
            hasWarnings: violations.some(v => v.severity === SEVERITY.WARNING),
            duration: Date.now() - startTime
        };
    }
    
    /**
     * Audit all scenarios in a template
     * 
     * @param {Object} template - The GlobalInstantResponseTemplate
     * @param {Object} options - Audit options
     * @returns {Object} Comprehensive audit report
     */
    async auditTemplate(template, options = {}) {
        const startTime = Date.now();
        
        // Extract all scenarios from template
        const scenarios = this._extractScenarios(template);
        
        this.logger.info(`[AUDIT] Starting audit of ${scenarios.length} scenarios from template "${template.templateType}"`);
        
        // Audit each scenario
        const scenarioResults = [];
        for (const scenario of scenarios) {
            const result = await this.auditScenario(scenario, {
                ...options,
                context: {
                    ...options.context,
                    template,
                    allScenarios: scenarios
                }
            });
            scenarioResults.push(result);
        }
        
        // Build summary
        const summary = this._buildSummary(scenarioResults);
        
        const report = {
            templateId: template._id,
            templateType: template.templateType,
            templateName: template.name,
            summary,
            scenarios: scenarioResults,
            rulesRun: this.rules.map(r => r.getMetadata()),
            timestamp: new Date().toISOString(),
            duration: Date.now() - startTime
        };
        
        this.logger.info(`[AUDIT] Completed in ${report.duration}ms:`, {
            totalScenarios: summary.totalScenarios,
            scenariosWithViolations: summary.scenariosWithViolations,
            totalViolations: summary.totalViolations,
            errors: summary.bySeverity.error,
            warnings: summary.bySeverity.warning
        });
        
        return report;
    }
    
    /**
     * Audit scenarios from a category
     */
    async auditCategory(template, categoryName, options = {}) {
        const scenarios = this._extractScenarios(template)
            .filter(s => s.categories?.includes(categoryName) || s.category === categoryName);
        
        const results = [];
        for (const scenario of scenarios) {
            const result = await this.auditScenario(scenario, options);
            results.push(result);
        }
        
        return {
            category: categoryName,
            summary: this._buildSummary(results),
            scenarios: results
        };
    }
    
    /**
     * Quick health check - returns true if template has no errors
     */
    async isTemplateHealthy(template) {
        const report = await this.auditTemplate(template);
        return report.summary.bySeverity.error === 0;
    }
    
    /**
     * Get available rules metadata (for UI)
     */
    getAvailableRules() {
        return getAllRuleMetadata();
    }
    
    /**
     * Extract all scenarios from template (handles nested categories)
     */
    _extractScenarios(template) {
        const scenarios = [];
        
        // Direct scenarios array
        if (Array.isArray(template.scenarios)) {
            scenarios.push(...template.scenarios);
        }
        
        // Scenarios nested in categories
        if (Array.isArray(template.categories)) {
            for (const category of template.categories) {
                if (Array.isArray(category.scenarios)) {
                    // Add category name to each scenario for context
                    const categoryScenarios = category.scenarios.map(s => ({
                        ...s.toObject ? s.toObject() : s,
                        _categoryName: category.name
                    }));
                    scenarios.push(...categoryScenarios);
                }
            }
        }
        
        return scenarios;
    }
    
    /**
     * Build summary statistics from scenario results
     */
    _buildSummary(scenarioResults) {
        const allViolations = scenarioResults.flatMap(r => r.violations);
        
        // Count by category
        const byCategory = {};
        for (const cat of Object.values(RULE_CATEGORIES)) {
            byCategory[cat] = allViolations.filter(v => v.category === cat).length;
        }
        
        // Count by severity
        const bySeverity = {
            error: allViolations.filter(v => v.severity === SEVERITY.ERROR).length,
            warning: allViolations.filter(v => v.severity === SEVERITY.WARNING).length,
            info: allViolations.filter(v => v.severity === SEVERITY.INFO).length
        };
        
        // Count by rule
        const byRule = {};
        for (const violation of allViolations) {
            byRule[violation.ruleId] = (byRule[violation.ruleId] || 0) + 1;
        }
        
        // Top violations (most common issues)
        const topViolations = Object.entries(byRule)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([ruleId, count]) => ({ ruleId, count }));
        
        return {
            totalScenarios: scenarioResults.length,
            scenariosWithViolations: scenarioResults.filter(r => r.violationCount > 0).length,
            scenariosWithErrors: scenarioResults.filter(r => r.hasErrors).length,
            scenariosWithWarnings: scenarioResults.filter(r => r.hasWarnings).length,
            scenariosPassing: scenarioResults.filter(r => r.violationCount === 0).length,
            totalViolations: allViolations.length,
            byCategory,
            bySeverity,
            byRule,
            topViolations,
            healthScore: this._calculateHealthScore(scenarioResults)
        };
    }
    
    /**
     * Calculate overall health score (0-100)
     */
    _calculateHealthScore(scenarioResults) {
        if (scenarioResults.length === 0) return 100;
        
        const allViolations = scenarioResults.flatMap(r => r.violations);
        
        // Weighted scoring: errors are worse than warnings
        const errorWeight = 10;
        const warningWeight = 3;
        const infoWeight = 1;
        
        const errorCount = allViolations.filter(v => v.severity === SEVERITY.ERROR).length;
        const warningCount = allViolations.filter(v => v.severity === SEVERITY.WARNING).length;
        const infoCount = allViolations.filter(v => v.severity === SEVERITY.INFO).length;
        
        const totalPenalty = (errorCount * errorWeight) + (warningCount * warningWeight) + (infoCount * infoWeight);
        const maxPenalty = scenarioResults.length * 50; // Arbitrary max
        
        const score = Math.max(0, Math.round(100 - (totalPenalty / maxPenalty * 100)));
        return score;
    }
}

module.exports = AuditEngine;
