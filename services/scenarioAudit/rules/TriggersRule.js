/**
 * TriggersRule - Checks trigger quality and coverage
 * 
 * Validates:
 * - Minimum/maximum number of triggers
 * - Trigger length (not too short, not too long)
 * - No generic triggers that cause false positives
 * - Regex triggers are valid
 * - Has variety (short + long triggers)
 * 
 * This is a DETERMINISTIC rule (no LLM cost).
 */

const BaseRule = require('./BaseRule');
const {
    TRIGGER_LIMITS,
    GENERIC_TRIGGERS,
    SEVERITY,
    RULE_CATEGORIES
} = require('../constants');

class TriggersRule extends BaseRule {
    constructor() {
        super();
        this.id = 'triggers';
        this.name = 'Trigger Quality Check';
        this.description = 'Ensures triggers have good coverage without being too generic';
        this.severity = SEVERITY.WARNING;
        this.category = RULE_CATEGORIES.TRIGGERS;
        this.costType = 'deterministic';
        this.enabledByDefault = true;
    }
    
    async check(scenario, context = {}) {
        const violations = [];
        
        // 1. Check trigger count
        violations.push(...this._checkTriggerCount(scenario));
        
        // 2. Check individual trigger quality
        violations.push(...this._checkTriggerQuality(scenario));
        
        // 3. Check for generic triggers
        violations.push(...this._checkGenericTriggers(scenario));
        
        // 4. Check regex triggers are valid
        violations.push(...this._checkRegexTriggers(scenario));
        
        // 5. Check trigger variety (short + long)
        violations.push(...this._checkTriggerVariety(scenario));
        
        return violations;
    }
    
    /**
     * Check trigger count is within limits
     */
    _checkTriggerCount(scenario) {
        const violations = [];
        const triggers = scenario.triggers || [];
        const count = triggers.length;
        
        if (count < TRIGGER_LIMITS.minTriggers) {
            violations.push(this.createViolation({
                field: 'triggers',
                value: `${count} triggers`,
                message: `Too few triggers: ${count} (minimum ${TRIGGER_LIMITS.minTriggers})`,
                suggestion: `Add more trigger variations. Recommended: ${TRIGGER_LIMITS.recommendedTriggers.min}-${TRIGGER_LIMITS.recommendedTriggers.max}`,
                meta: { count, min: TRIGGER_LIMITS.minTriggers }
            }));
        }
        
        if (count > TRIGGER_LIMITS.maxTriggers) {
            violations.push(this.createViolation({
                field: 'triggers',
                value: `${count} triggers`,
                message: `Too many triggers: ${count} (maximum ${TRIGGER_LIMITS.maxTriggers})`,
                suggestion: 'Too many triggers can cause overlap with other scenarios. Consider splitting into multiple scenarios.',
                meta: { count, max: TRIGGER_LIMITS.maxTriggers }
            }));
        }
        
        return violations;
    }
    
    /**
     * Check individual trigger length and format
     */
    _checkTriggerQuality(scenario) {
        const violations = [];
        const triggers = scenario.triggers || [];
        
        for (let i = 0; i < triggers.length; i++) {
            const trigger = triggers[i];
            if (!trigger) continue;
            
            const length = trigger.length;
            
            // Too short
            if (length < TRIGGER_LIMITS.minTriggerLength) {
                violations.push(this.createViolation({
                    field: `triggers[${i}]`,
                    value: trigger,
                    message: `Trigger too short: "${trigger}" (${length} chars, min ${TRIGGER_LIMITS.minTriggerLength})`,
                    suggestion: 'Single characters or very short triggers cause false positives',
                    meta: { length, min: TRIGGER_LIMITS.minTriggerLength }
                }));
            }
            
            // Too long
            if (length > TRIGGER_LIMITS.maxTriggerLength) {
                violations.push(this.createViolation({
                    field: `triggers[${i}]`,
                    value: trigger,
                    message: `Trigger too long: ${length} chars (max ${TRIGGER_LIMITS.maxTriggerLength})`,
                    suggestion: 'Very long triggers are unlikely to match exactly. Break into smaller phrases.',
                    meta: { length, max: TRIGGER_LIMITS.maxTriggerLength }
                }));
            }
        }
        
        return violations;
    }
    
    /**
     * Check for overly generic triggers
     */
    _checkGenericTriggers(scenario) {
        const violations = [];
        const triggers = scenario.triggers || [];
        
        for (let i = 0; i < triggers.length; i++) {
            const trigger = (triggers[i] || '').toLowerCase().trim();
            
            if (GENERIC_TRIGGERS.includes(trigger)) {
                violations.push(this.createViolation({
                    field: `triggers[${i}]`,
                    value: triggers[i],
                    message: `Generic trigger: "${trigger}" will match too many unrelated calls`,
                    suggestion: 'Add more context to the trigger. Example: "yes please" instead of "yes"',
                    meta: { genericTrigger: trigger }
                }));
            }
        }
        
        return violations;
    }
    
    /**
     * Validate regex triggers are syntactically correct
     */
    _checkRegexTriggers(scenario) {
        const violations = [];
        const regexTriggers = scenario.regexTriggers || [];
        
        for (let i = 0; i < regexTriggers.length; i++) {
            const pattern = regexTriggers[i];
            if (!pattern) continue;
            
            try {
                new RegExp(pattern, 'i');
            } catch (e) {
                violations.push(this.createViolation({
                    field: `regexTriggers[${i}]`,
                    value: pattern,
                    message: `Invalid regex pattern: ${e.message}`,
                    suggestion: 'Fix the regex syntax. Use \\b for word boundaries, escape special characters.',
                    meta: { error: e.message }
                }));
            }
        }
        
        return violations;
    }
    
    /**
     * Check for variety in trigger lengths (short + long)
     */
    _checkTriggerVariety(scenario) {
        const violations = [];
        const triggers = scenario.triggers || [];
        
        if (triggers.length < 5) return violations; // Not enough triggers to check variety
        
        const lengths = triggers.map(t => this.countWords(t || ''));
        const shortTriggers = lengths.filter(l => l <= 3).length;
        const longTriggers = lengths.filter(l => l >= 5).length;
        
        // Need at least some short triggers (2-3 words)
        if (shortTriggers === 0) {
            violations.push(this.createViolation({
                field: 'triggers',
                value: `${triggers.length} triggers, 0 short`,
                message: 'No short triggers (2-3 words)',
                suggestion: 'Add short trigger variations like "ac broken", "need help", "not working"',
                meta: { shortTriggers, total: triggers.length }
            }));
        }
        
        // Need at least some long triggers (5+ words)
        if (longTriggers === 0) {
            violations.push(this.createViolation({
                field: 'triggers',
                value: `${triggers.length} triggers, 0 long`,
                message: 'No long triggers (5+ words)',
                suggestion: 'Add longer natural phrases like "my air conditioning is not working"',
                meta: { longTriggers, total: triggers.length }
            }));
        }
        
        return violations;
    }
}

module.exports = TriggersRule;
