/**
 * CompletenessRule - Checks for missing or incomplete fields
 * 
 * Validates:
 * - Required fields are present (name, triggers, quickReplies)
 * - Arrays are not empty where they shouldn't be
 * - scenarioType is set (not UNKNOWN)
 * - Categories are assigned
 * 
 * This is a DETERMINISTIC rule (no LLM cost).
 */

const BaseRule = require('./BaseRule');
const {
    SCENARIO_TYPES,
    APPROVED_BEHAVIORS,
    BANNED_BEHAVIORS,
    SEVERITY,
    RULE_CATEGORIES
} = require('../constants');

class CompletenessRule extends BaseRule {
    constructor() {
        super();
        this.id = 'completeness';
        this.name = 'Completeness Check';
        this.description = 'Ensures all required fields are present and properly configured';
        this.severity = SEVERITY.WARNING;
        this.category = RULE_CATEGORIES.COMPLETENESS;
        this.costType = 'deterministic';
        this.enabledByDefault = true;
        
        // Fields that must have values
        this.requiredFields = [
            { field: 'name', label: 'Scenario name' },
            { field: 'triggers', label: 'Triggers', isArray: true, minLength: 1 },
            { field: 'quickReplies', label: 'Quick replies', isArray: true, minLength: 1 }
        ];
        
        // Fields that should be set (warning if missing)
        this.recommendedFields = [
            { field: 'scenarioType', label: 'Scenario type', default: 'UNKNOWN' },
            { field: 'categories', label: 'Categories', isArray: true },
            { field: 'behavior', label: 'Behavior/tone' }
        ];
    }
    
    async check(scenario, context = {}) {
        const violations = [];
        
        // 1. Check required fields
        violations.push(...this._checkRequiredFields(scenario));
        
        // 2. Check recommended fields
        violations.push(...this._checkRecommendedFields(scenario));
        
        // 3. Check scenarioType is not UNKNOWN
        violations.push(...this._checkScenarioType(scenario));
        
        // 4. Check behavior is valid
        violations.push(...this._checkBehavior(scenario));
        
        // 5. Check for empty replies
        violations.push(...this._checkEmptyReplies(scenario));
        
        return violations;
    }
    
    /**
     * Check required fields are present
     */
    _checkRequiredFields(scenario) {
        const violations = [];
        
        for (const { field, label, isArray, minLength } of this.requiredFields) {
            const value = scenario[field];
            
            if (isArray) {
                if (!Array.isArray(value) || value.length < (minLength || 1)) {
                    violations.push(this.createViolation({
                        field: field,
                        value: value ? `${value.length} items` : null,
                        message: `${label} is required (minimum ${minLength || 1})`,
                        suggestion: `Add at least ${minLength || 1} ${label.toLowerCase()}`,
                        meta: { required: true, minLength }
                    }));
                }
            } else {
                if (!value || (typeof value === 'string' && !value.trim())) {
                    violations.push(this.createViolation({
                        field: field,
                        value: null,
                        message: `${label} is required`,
                        suggestion: `Provide a ${label.toLowerCase()}`,
                        meta: { required: true }
                    }));
                }
            }
        }
        
        return violations;
    }
    
    /**
     * Check recommended fields
     */
    _checkRecommendedFields(scenario) {
        const violations = [];
        
        for (const { field, label, isArray, default: defaultValue } of this.recommendedFields) {
            const value = scenario[field];
            
            if (isArray) {
                if (!Array.isArray(value) || value.length === 0) {
                    this.severity = SEVERITY.INFO; // Lower severity for recommendations
                    violations.push(this.createViolation({
                        field: field,
                        value: null,
                        message: `${label} is recommended but empty`,
                        suggestion: `Add ${label.toLowerCase()} for better organization`,
                        meta: { recommended: true }
                    }));
                    this.severity = SEVERITY.WARNING; // Reset
                }
            } else if (defaultValue !== undefined) {
                if (value === defaultValue || !value) {
                    this.severity = SEVERITY.INFO;
                    violations.push(this.createViolation({
                        field: field,
                        value: value || null,
                        message: `${label} is not set (using default: ${defaultValue})`,
                        suggestion: `Set ${label.toLowerCase()} explicitly`,
                        meta: { recommended: true, defaultValue }
                    }));
                    this.severity = SEVERITY.WARNING;
                }
            }
        }
        
        return violations;
    }
    
    /**
     * Check scenarioType is set and valid
     */
    _checkScenarioType(scenario) {
        const violations = [];
        const scenarioType = scenario.scenarioType;
        
        if (scenarioType === 'UNKNOWN' || !scenarioType) {
            violations.push(this.createViolation({
                field: 'scenarioType',
                value: scenarioType || null,
                message: 'scenarioType is UNKNOWN - should be classified',
                suggestion: `Set to one of: ${SCENARIO_TYPES.filter(t => t !== 'UNKNOWN').join(', ')}`,
                meta: { validValues: SCENARIO_TYPES }
            }));
        } else if (!SCENARIO_TYPES.includes(scenarioType)) {
            violations.push(this.createViolation({
                field: 'scenarioType',
                value: scenarioType,
                message: `Unknown scenarioType: "${scenarioType}"`,
                suggestion: `Valid values: ${SCENARIO_TYPES.join(', ')}`,
                meta: { validValues: SCENARIO_TYPES }
            }));
        }
        
        return violations;
    }
    
    /**
     * Check behavior is valid
     */
    _checkBehavior(scenario) {
        const violations = [];
        const behavior = scenario.behavior;
        
        if (!behavior) return violations; // Optional field
        
        // Check for banned behaviors
        const lowerBehavior = behavior.toLowerCase();
        for (const banned of BANNED_BEHAVIORS) {
            if (lowerBehavior.includes(banned.toLowerCase())) {
                violations.push(this.createViolation({
                    field: 'behavior',
                    value: behavior,
                    message: `Behavior "${behavior}" makes AI chatty - not dispatcher style`,
                    suggestion: `Use: ${APPROVED_BEHAVIORS.join(', ')}`,
                    meta: { bannedBehavior: banned, approvedBehaviors: APPROVED_BEHAVIORS }
                }));
                break;
            }
        }
        
        return violations;
    }
    
    /**
     * Check for empty or placeholder replies
     */
    _checkEmptyReplies(scenario) {
        const violations = [];
        
        const replyFields = [
            { name: 'quickReplies', values: scenario.quickReplies || [] },
            { name: 'fullReplies', values: scenario.fullReplies || [] }
        ];
        
        for (const field of replyFields) {
            for (let i = 0; i < field.values.length; i++) {
                const reply = field.values[i];
                
                // Handle both string and {text, weight} formats
                const text = typeof reply === 'string' ? reply : reply?.text;
                
                if (!text || text.trim().length < 5) {
                    violations.push(this.createViolation({
                        field: `${field.name}[${i}]`,
                        value: text || null,
                        message: `Empty or too short reply in ${field.name}`,
                        suggestion: 'Provide a meaningful response',
                        meta: { index: i }
                    }));
                }
                
                // Check for placeholder text that wasn't replaced
                if (text && (text.includes('[') || text.includes('TODO') || text.includes('FIXME'))) {
                    violations.push(this.createViolation({
                        field: `${field.name}[${i}]`,
                        value: text,
                        message: 'Reply contains placeholder or TODO text',
                        suggestion: 'Replace placeholder with actual response text',
                        meta: { index: i }
                    }));
                }
            }
        }
        
        return violations;
    }
}

module.exports = CompletenessRule;
