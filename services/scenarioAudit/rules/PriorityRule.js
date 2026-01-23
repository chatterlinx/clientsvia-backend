/**
 * PriorityRule - Checks priority and confidence settings
 * 
 * Validates:
 * - Priority matches expected range for scenarioType
 * - Emergency scenarios have high priority
 * - Small talk has low priority
 * - minConfidence is set appropriately
 * 
 * This is a DETERMINISTIC rule (no LLM cost).
 */

const BaseRule = require('./BaseRule');
const {
    PRIORITY_RANGES,
    SEVERITY,
    RULE_CATEGORIES
} = require('../constants');

class PriorityRule extends BaseRule {
    constructor() {
        super();
        this.id = 'priority';
        this.name = 'Priority Check';
        this.description = 'Ensures priority and confidence match scenario type';
        this.severity = SEVERITY.WARNING;
        this.category = RULE_CATEGORIES.PRIORITY;
        this.costType = 'deterministic';
        this.enabledByDefault = true;
    }
    
    async check(scenario, context = {}) {
        const violations = [];
        
        // 1. Check priority matches scenario type
        violations.push(...this._checkPriorityRange(scenario));
        
        // 2. Check critical scenarios have appropriate priority
        violations.push(...this._checkCriticalPriority(scenario));
        
        // 3. Check minConfidence is reasonable
        violations.push(...this._checkConfidence(scenario));
        
        return violations;
    }
    
    /**
     * Check priority is within expected range for scenario type
     */
    _checkPriorityRange(scenario) {
        const violations = [];
        const scenarioType = scenario.scenarioType || 'UNKNOWN';
        const priority = scenario.priority;
        
        if (priority === undefined || priority === null) return violations;
        
        const expectedRange = PRIORITY_RANGES[scenarioType];
        if (!expectedRange) return violations;
        
        if (priority < expectedRange.min || priority > expectedRange.max) {
            violations.push(this.createViolation({
                field: 'priority',
                value: priority,
                message: `Priority ${priority} outside expected range for ${scenarioType} (${expectedRange.min}-${expectedRange.max})`,
                suggestion: `Set priority between ${expectedRange.min} and ${expectedRange.max} for ${scenarioType} scenarios`,
                meta: { 
                    scenarioType, 
                    priority,
                    expectedMin: expectedRange.min,
                    expectedMax: expectedRange.max
                }
            }));
        }
        
        return violations;
    }
    
    /**
     * Check critical scenarios have appropriate priority
     */
    _checkCriticalPriority(scenario) {
        const violations = [];
        const scenarioType = scenario.scenarioType || 'UNKNOWN';
        const priority = scenario.priority || 0;
        const name = (scenario.name || '').toLowerCase();
        
        // Emergency scenarios MUST have high priority
        if (scenarioType === 'EMERGENCY' && priority < 85) {
            violations.push(this.createViolation({
                field: 'priority',
                value: priority,
                message: `EMERGENCY scenario with low priority (${priority}) - should be 90+`,
                suggestion: 'Emergency scenarios need priority 90-100 to ensure they match first',
                meta: { scenarioType, priority, recommended: '90-100' }
            }));
        }
        
        // TRANSFER scenarios should have high priority
        if (scenarioType === 'TRANSFER' && priority < 75) {
            violations.push(this.createViolation({
                field: 'priority',
                value: priority,
                message: `TRANSFER scenario with low priority (${priority}) - should be 80+`,
                suggestion: 'Transfer requests should have high priority to avoid frustrating callers',
                meta: { scenarioType, priority, recommended: '80-90' }
            }));
        }
        
        // Check for emergency keywords in name but wrong type
        const emergencyKeywords = ['emergency', 'urgent', 'gas leak', 'flood', 'no heat', 'fire'];
        const hasEmergencyKeyword = emergencyKeywords.some(kw => name.includes(kw));
        
        if (hasEmergencyKeyword && scenarioType !== 'EMERGENCY') {
            violations.push(this.createViolation({
                field: 'scenarioType',
                value: scenarioType,
                message: `Scenario "${scenario.name}" contains emergency keywords but type is ${scenarioType}`,
                suggestion: 'Consider changing scenarioType to EMERGENCY',
                meta: { name: scenario.name, currentType: scenarioType }
            }));
        }
        
        return violations;
    }
    
    /**
     * Check minConfidence is reasonable
     */
    _checkConfidence(scenario) {
        const violations = [];
        const minConfidence = scenario.minConfidence;
        const scenarioType = scenario.scenarioType || 'UNKNOWN';
        
        if (minConfidence === undefined || minConfidence === null) return violations;
        
        // Confidence must be 0-1
        if (minConfidence < 0 || minConfidence > 1) {
            violations.push(this.createViolation({
                field: 'minConfidence',
                value: minConfidence,
                message: `Invalid minConfidence: ${minConfidence} (must be 0-1)`,
                suggestion: 'Set minConfidence between 0 and 1',
                meta: { minConfidence }
            }));
        }
        
        // Very high confidence (>0.95) means scenario will rarely match
        if (minConfidence > 0.95) {
            violations.push(this.createViolation({
                field: 'minConfidence',
                value: minConfidence,
                message: `Very high minConfidence (${minConfidence}) - scenario may rarely match`,
                suggestion: 'Consider lowering to 0.7-0.85 unless exact matching is required',
                meta: { minConfidence }
            }));
        }
        
        // Very low confidence (<0.3) means scenario matches too easily
        if (minConfidence < 0.3 && minConfidence > 0) {
            violations.push(this.createViolation({
                field: 'minConfidence',
                value: minConfidence,
                message: `Very low minConfidence (${minConfidence}) - scenario may match incorrectly`,
                suggestion: 'Consider raising to 0.5-0.7 to reduce false positives',
                meta: { minConfidence }
            }));
        }
        
        // Emergency scenarios should have lower confidence threshold (catch more)
        if (scenarioType === 'EMERGENCY' && minConfidence > 0.7) {
            violations.push(this.createViolation({
                field: 'minConfidence',
                value: minConfidence,
                message: `EMERGENCY scenario with high minConfidence (${minConfidence}) may miss urgent calls`,
                suggestion: 'Lower to 0.5-0.6 for emergency scenarios to catch more matches',
                meta: { scenarioType, minConfidence }
            }));
        }
        
        return violations;
    }
}

module.exports = PriorityRule;
