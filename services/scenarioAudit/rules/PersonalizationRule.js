/**
 * PersonalizationRule - Checks for proper name/placeholder usage
 * 
 * Rules:
 * 1. Scenarios should include {name} in at least one reply
 * 2. If {name} is used, _noName variants should exist
 * 3. Only approved placeholders should be used
 * 4. No deprecated placeholders ({firstName}, {customerName}, etc.)
 * 
 * This is a DETERMINISTIC rule (no LLM cost).
 */

const BaseRule = require('./BaseRule');
const {
    ALLOWED_PLACEHOLDERS,
    DEPRECATED_PLACEHOLDERS,
    SEVERITY,
    RULE_CATEGORIES
} = require('../constants');

class PersonalizationRule extends BaseRule {
    constructor() {
        super();
        this.id = 'personalization';
        this.name = 'Personalization Check';
        this.description = 'Ensures proper use of {name} placeholder and personalization variants';
        this.severity = SEVERITY.WARNING;
        this.category = RULE_CATEGORIES.PERSONALIZATION;
        this.costType = 'deterministic';
        this.enabledByDefault = true;
        
        // Scenario types that MUST have {name} acknowledgment
        this.nameRequiredTypes = [
            'SMALL_TALK',
            'GREETING'
        ];
        
        // Categories that typically involve name capture
        this.nameExpectedCategories = [
            'Small_Talk',
            'Greeting',
            'General'
        ];
    }
    
    async check(scenario, context = {}) {
        const violations = [];
        
        // 1. Check for deprecated placeholders
        violations.push(...this._checkDeprecatedPlaceholders(scenario));
        
        // 2. Check for unknown placeholders
        violations.push(...this._checkUnknownPlaceholders(scenario));
        
        // 3. Check if {name} is used but _noName variants are missing
        violations.push(...this._checkNoNameVariants(scenario));
        
        // 4. Check if scenario type requires {name} but doesn't have it
        violations.push(...this._checkNameRequired(scenario));
        
        return violations;
    }
    
    /**
     * Check for deprecated placeholders that should be replaced
     */
    _checkDeprecatedPlaceholders(scenario) {
        const violations = [];
        const allText = this._getAllReplyText(scenario);
        
        for (const placeholder of DEPRECATED_PLACEHOLDERS) {
            if (allText.includes(placeholder)) {
                violations.push(this.createViolation({
                    field: 'replies',
                    value: placeholder,
                    message: `Uses deprecated placeholder: ${placeholder}`,
                    suggestion: `Replace ${placeholder} with {name} for consistency`,
                    meta: { deprecatedPlaceholder: placeholder }
                }));
            }
        }
        
        return violations;
    }
    
    /**
     * Check for unknown/unsupported placeholders
     */
    _checkUnknownPlaceholders(scenario) {
        const violations = [];
        const allText = this._getAllReplyText(scenario);
        const foundPlaceholders = this.extractPlaceholders(allText);
        
        for (const placeholder of foundPlaceholders) {
            const isAllowed = ALLOWED_PLACEHOLDERS.some(
                allowed => allowed.toLowerCase() === placeholder.toLowerCase()
            );
            const isDeprecated = DEPRECATED_PLACEHOLDERS.some(
                dep => dep.toLowerCase() === placeholder.toLowerCase()
            );
            
            if (!isAllowed && !isDeprecated) {
                violations.push(this.createViolation({
                    field: 'replies',
                    value: placeholder,
                    message: `Unknown placeholder: ${placeholder}`,
                    suggestion: `Allowed placeholders: ${ALLOWED_PLACEHOLDERS.join(', ')}`,
                    meta: { unknownPlaceholder: placeholder }
                }));
            }
        }
        
        return violations;
    }
    
    /**
     * Check if {name} is used but _noName variants are missing
     */
    _checkNoNameVariants(scenario) {
        const violations = [];
        
        // Check quickReplies
        const quickRepliesHasName = this._hasNamePlaceholder(scenario.quickReplies);
        const hasQuickRepliesNoName = Array.isArray(scenario.quickReplies_noName) && 
                                       scenario.quickReplies_noName.length > 0;
        
        if (quickRepliesHasName && !hasQuickRepliesNoName) {
            violations.push(this.createViolation({
                field: 'quickReplies_noName',
                value: null,
                message: 'quickReplies uses {name} but quickReplies_noName is missing',
                suggestion: 'Add quickReplies_noName variants for when caller name is unknown',
                meta: { missingVariant: 'quickReplies_noName' }
            }));
        }
        
        // Check fullReplies
        const fullRepliesHasName = this._hasNamePlaceholder(scenario.fullReplies);
        const hasFullRepliesNoName = Array.isArray(scenario.fullReplies_noName) && 
                                      scenario.fullReplies_noName.length > 0;
        
        if (fullRepliesHasName && !hasFullRepliesNoName) {
            violations.push(this.createViolation({
                field: 'fullReplies_noName',
                value: null,
                message: 'fullReplies uses {name} but fullReplies_noName is missing',
                suggestion: 'Add fullReplies_noName variants for when caller name is unknown',
                meta: { missingVariant: 'fullReplies_noName' }
            }));
        }
        
        return violations;
    }
    
    /**
     * Check if scenario type requires {name} but doesn't have it
     */
    _checkNameRequired(scenario) {
        const violations = [];
        
        const scenarioType = scenario.scenarioType || '';
        const category = scenario.category || '';
        
        // Only enforce for specific types/categories
        const isNameExpected = this.nameRequiredTypes.includes(scenarioType) ||
                               this.nameExpectedCategories.includes(category);
        
        if (!isNameExpected) return violations;
        
        // Check if ANY reply has {name}
        const hasName = this._hasNamePlaceholder(scenario.quickReplies) ||
                        this._hasNamePlaceholder(scenario.fullReplies);
        
        if (!hasName) {
            violations.push(this.createViolation({
                field: 'replies',
                value: scenario.scenarioType || scenario.category,
                message: `${scenarioType || category} scenario should acknowledge caller by name`,
                suggestion: 'Add at least one reply with {name} placeholder: "Thanks, {name}. What\'s going on?"',
                meta: { 
                    scenarioType,
                    category,
                    reason: 'name_expected'
                }
            }));
        }
        
        return violations;
    }
    
    /**
     * Get all reply text concatenated for searching
     */
    _getAllReplyText(scenario) {
        const texts = [
            ...(scenario.quickReplies || []),
            ...(scenario.fullReplies || []),
            ...(scenario.quickReplies_noName || []),
            ...(scenario.fullReplies_noName || []),
            ...(scenario.followUpMessages || []),
            scenario.followUpQuestionText || ''
        ];
        return texts.filter(Boolean).join(' ');
    }
    
    /**
     * Check if any text in array contains {name} placeholder
     */
    _hasNamePlaceholder(replies) {
        if (!Array.isArray(replies)) return false;
        return replies.some(reply => reply && reply.toLowerCase().includes('{name}'));
    }
}

module.exports = PersonalizationRule;
