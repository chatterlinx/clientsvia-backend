/**
 * Rule Registry - Central registry of all audit rules
 * 
 * To add a new rule:
 * 1. Create a new file in this folder extending BaseRule
 * 2. Import and register it here
 * 
 * Rules are automatically available to the AuditEngine.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * RULE COVERAGE (all scenario fields audited)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * TONE RULES:
 *   BannedPhrasesRule - Chatbot/helpdesk/troubleshooting language
 * 
 * PERSONALIZATION RULES:
 *   PersonalizationRule - {name} placeholder usage, _noName variants
 * 
 * STRUCTURE RULES:
 *   ResponseLengthRule - Word count limits
 *   StructureRule - Quick=classify, Full=book, no stacking
 * 
 * TRIGGER RULES:
 *   TriggersRule - Count, length, generic, regex validity, variety
 * 
 * WIRING RULES:
 *   WiringRule - actionType, flowId, transferTarget, bookingIntent
 * 
 * COMPLETENESS RULES:
 *   CompletenessRule - Required fields, scenarioType, behavior
 * 
 * PRIORITY RULES:
 *   PriorityRule - Priority ranges, confidence thresholds
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const BannedPhrasesRule = require('./BannedPhrasesRule');
const PersonalizationRule = require('./PersonalizationRule');
const ResponseLengthRule = require('./ResponseLengthRule');
const StructureRule = require('./StructureRule');
const TriggersRule = require('./TriggersRule');
const WiringRule = require('./WiringRule');
const CompletenessRule = require('./CompletenessRule');
const PriorityRule = require('./PriorityRule');
const FullScenarioRule = require('./FullScenarioRule');

// ═══════════════════════════════════════════════════════════════════════════════
// RULE REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * All available rules (deterministic - no LLM cost)
 * 
 * Order matters for output readability:
 * 1. Completeness (missing fields)
 * 2. Wiring (broken connections)
 * 3. Tone (banned phrases)
 * 4. Structure (booking in quick replies)
 * 5. Personalization ({name} usage)
 * 6. Response length (word counts)
 * 7. Triggers (quality/coverage)
 * 8. Priority (ranges/confidence)
 */
const RULES = [
    new CompletenessRule(),    // Missing fields first
    new WiringRule(),          // Broken wiring second
    new BannedPhrasesRule(),   // Tone violations
    new StructureRule(),       // Structural issues
    new PersonalizationRule(), // Placeholder usage
    new ResponseLengthRule(),  // Length violations
    new TriggersRule(),        // Trigger quality
    new PriorityRule(),        // Priority mismatches
    new FullScenarioRule()     // Comprehensive check (all other settings)
];

/**
 * Get all registered rules
 */
function getAllRules() {
    return RULES;
}

/**
 * Get rules by category
 */
function getRulesByCategory(category) {
    return RULES.filter(rule => rule.category === category);
}

/**
 * Get rules by cost type
 */
function getRulesByCostType(costType) {
    return RULES.filter(rule => rule.costType === costType);
}

/**
 * Get a specific rule by ID
 */
function getRuleById(ruleId) {
    return RULES.find(rule => rule.id === ruleId);
}

/**
 * Get all rule metadata (for UI/documentation)
 */
function getAllRuleMetadata() {
    return RULES.map(rule => rule.getMetadata());
}

/**
 * Get default-enabled rules only
 */
function getDefaultRules() {
    return RULES.filter(rule => rule.enabledByDefault);
}

/**
 * Get deterministic rules only (no LLM cost)
 */
function getDeterministicRules() {
    return RULES.filter(rule => rule.costType === 'deterministic');
}

/**
 * Get LLM-based rules only (requires API calls)
 */
function getLLMRules() {
    return RULES.filter(rule => rule.costType === 'llm');
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    // Rule instances
    RULES,
    
    // Getters
    getAllRules,
    getRulesByCategory,
    getRulesByCostType,
    getRuleById,
    getAllRuleMetadata,
    getDefaultRules,
    getDeterministicRules,
    getLLMRules,
    
    // Individual rule classes (for direct instantiation if needed)
    BannedPhrasesRule,
    PersonalizationRule,
    ResponseLengthRule,
    StructureRule,
    TriggersRule,
    WiringRule,
    CompletenessRule,
    PriorityRule,
    FullScenarioRule
};
