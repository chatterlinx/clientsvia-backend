/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SCENARIO AUDIT SERVICE
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Comprehensive scenario auditing system that validates scenarios against
 * dispatcher personality rules, structural requirements, and best practices.
 * 
 * FEATURES:
 * - 8 deterministic rules (no LLM cost)
 * - Extensible rule system (add new rules easily)
 * - Template-wide or single-scenario auditing
 * - Health scoring (0-100)
 * - Detailed violation reports with suggestions
 * 
 * USAGE:
 * 
 *   const { AuditEngine } = require('./services/scenarioAudit');
 *   const engine = new AuditEngine();
 *   
 *   // Audit entire template
 *   const report = await engine.auditTemplate(template);
 *   console.log(report.summary.healthScore); // 0-100
 *   
 *   // Audit single scenario
 *   const result = await engine.auditScenario(scenario);
 *   if (result.hasErrors) {
 *       console.log('Fix these:', result.violations);
 *   }
 * 
 * RULE CATEGORIES:
 * 
 *   TONE:
 *     - BannedPhrasesRule: Chatbot/helpdesk/troubleshooting language
 *   
 *   PERSONALIZATION:
 *     - PersonalizationRule: {name} placeholder, _noName variants
 *   
 *   STRUCTURE:
 *     - ResponseLengthRule: Word count limits
 *     - StructureRule: Quick=classify, Full=book
 *   
 *   TRIGGERS:
 *     - TriggersRule: Count, length, generics, regex validity
 *   
 *   WIRING:
 *     - WiringRule: actionType, flowId, transferTarget
 *   
 *   COMPLETENESS:
 *     - CompletenessRule: Required fields, scenarioType
 *   
 *   PRIORITY:
 *     - PriorityRule: Priority ranges, confidence thresholds
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const AuditEngine = require('./AuditEngine');
const constants = require('./constants');
const rules = require('./rules');

// ═══════════════════════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Quick audit a single scenario
 */
async function auditScenario(scenario, options = {}) {
    const engine = new AuditEngine();
    return engine.auditScenario(scenario, options);
}

/**
 * Quick audit an entire template
 */
async function auditTemplate(template, options = {}) {
    const engine = new AuditEngine();
    return engine.auditTemplate(template, options);
}

/**
 * Check if template is healthy (no errors)
 */
async function isTemplateHealthy(template) {
    const engine = new AuditEngine();
    return engine.isTemplateHealthy(template);
}

/**
 * Get list of all available rules
 */
function getAvailableRules() {
    return rules.getAllRuleMetadata();
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    // Main engine class
    AuditEngine,
    
    // Convenience functions
    auditScenario,
    auditTemplate,
    isTemplateHealthy,
    getAvailableRules,
    
    // Constants (for custom rules or UI)
    constants,
    
    // Rules (for direct access or custom engines)
    rules
};
