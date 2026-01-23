/**
 * BaseRule - Abstract base class for all audit rules
 * 
 * All audit rules must extend this class and implement:
 * - check(scenario, context) - Returns array of violations
 * 
 * Rules are designed to be:
 * - Stateless (no side effects)
 * - Deterministic or LLM-based (declared via costType)
 * - Self-documenting (metadata describes what they check)
 */

const { SEVERITY, RULE_CATEGORIES } = require('../constants');

class BaseRule {
    constructor() {
        // Rule identity (must be overridden)
        this.id = 'base-rule';
        this.name = 'Base Rule';
        this.description = 'Base rule class - do not use directly';
        
        // Rule classification
        this.severity = SEVERITY.WARNING;
        this.category = RULE_CATEGORIES.TONE;
        
        // Cost classification
        // - 'deterministic': No API calls, instant
        // - 'llm': Requires GPT call, costs tokens
        this.costType = 'deterministic';
        
        // Whether this rule is enabled by default
        this.enabledByDefault = true;
    }
    
    /**
     * Check a scenario for violations
     * 
     * @param {Object} scenario - The scenario to check
     * @param {Object} context - Additional context (template, allScenarios, etc.)
     * @returns {Array<Violation>} Array of violations found
     * 
     * Violation format:
     * {
     *   ruleId: 'banned-phrases',
     *   ruleName: 'Banned Phrases Check',
     *   severity: 'error',
     *   field: 'quickReplies[0]',
     *   value: 'Got it. What can I help you with?',
     *   message: 'Contains banned phrase: "Got it"',
     *   suggestion: 'Replace with: "I understand." or "Alright."'
     * }
     */
    async check(scenario, context = {}) {
        throw new Error(`Rule ${this.id} must implement check() method`);
    }
    
    /**
     * Create a violation object with consistent structure
     */
    createViolation({ field, value, message, suggestion = null, meta = {} }) {
        return {
            ruleId: this.id,
            ruleName: this.name,
            severity: this.severity,
            category: this.category,
            field,
            value: this._truncateValue(value),
            message,
            suggestion,
            ...meta
        };
    }
    
    /**
     * Truncate long values for cleaner output
     */
    _truncateValue(value, maxLength = 100) {
        if (!value) return value;
        const str = String(value);
        if (str.length <= maxLength) return str;
        return str.substring(0, maxLength) + '...';
    }
    
    /**
     * Check if a string contains any of the given phrases (case-insensitive)
     */
    containsPhrase(text, phrases) {
        if (!text) return null;
        const lowerText = text.toLowerCase();
        for (const phrase of phrases) {
            if (lowerText.includes(phrase.toLowerCase())) {
                return phrase;
            }
        }
        return null;
    }
    
    /**
     * Count words in a string
     */
    countWords(text) {
        if (!text) return 0;
        return text.trim().split(/\s+/).filter(w => w.length > 0).length;
    }
    
    /**
     * Extract all placeholders from text
     */
    extractPlaceholders(text) {
        if (!text) return [];
        const matches = text.match(/\{[^}]+\}/g);
        return matches || [];
    }
    
    /**
     * Get rule metadata for documentation/UI
     */
    getMetadata() {
        return {
            id: this.id,
            name: this.name,
            description: this.description,
            severity: this.severity,
            category: this.category,
            costType: this.costType,
            enabledByDefault: this.enabledByDefault
        };
    }
}

module.exports = BaseRule;
