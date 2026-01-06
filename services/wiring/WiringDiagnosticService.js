/**
 * ============================================================================
 * WIRING DIAGNOSTIC SERVICE - Evidence-First Flight Recorder
 * ============================================================================
 * 
 * THIS IS NOT A HEURISTIC GUESSING SERVICE.
 * 
 * This service analyzes ACTUAL debugSnapshot evidence from test responses
 * and produces DETERMINISTIC diagnoses using a Failure→Node mapping table.
 * 
 * Every diagnostic item MUST include:
 * - nodeId: Exact wiring registry node
 * - evidence: Raw values observed
 * - rule: Why this value is problematic
 * - fix: Exact action to take
 * - deepLink: URL to that section
 * 
 * ============================================================================
 */

const logger = require('../../utils/logger');

// ============================================================================
// DETERMINISTIC FAILURE → NODE MAPPING TABLE
// ============================================================================
// This is the "engineering bible" - not smart, just deterministic rules.
// Each entry maps observed evidence patterns to exact wiring nodes.
// ============================================================================

const FAILURE_NODE_MAP = [
    // =========================================================================
    // KILL SWITCHES
    // =========================================================================
    {
        id: 'KILL_SWITCH_FORCE_LLM',
        check: (evidence) => evidence.killSwitches?.forceLLMDiscovery === true,
        severity: 'CRITICAL',
        nodeId: 'frontDesk.discoveryConsent.forceLLMDiscovery',
        title: 'Kill Switch: Force LLM Discovery ON',
        rule: 'When forceLLMDiscovery=true, scenarios cannot auto-respond. LLM leads all conversations.',
        fix: 'Set forceLLMDiscovery to false in Front Desk → Discovery & Consent',
        dbPath: 'aiAgentSettings.frontDeskBehavior.discoveryConsent.forceLLMDiscovery',
        deepLinkSection: 'killSwitches'
    },
    {
        id: 'KILL_SWITCH_DISABLE_SCENARIOS',
        check: (evidence) => evidence.killSwitches?.disableScenarioAutoResponses === true,
        severity: 'CRITICAL',
        nodeId: 'frontDesk.discoveryConsent.disableScenarioAutoResponses',
        title: 'Kill Switch: Scenario Auto-Responses DISABLED',
        rule: 'When disableScenarioAutoResponses=true, scenarios match but cannot respond.',
        fix: 'Set disableScenarioAutoResponses to false in Front Desk → Discovery & Consent',
        dbPath: 'aiAgentSettings.frontDeskBehavior.discoveryConsent.disableScenarioAutoResponses',
        deepLinkSection: 'killSwitches'
    },
    
    // =========================================================================
    // TEMPLATE & SCENARIO LOADING
    // =========================================================================
    {
        id: 'NO_TEMPLATE_REFERENCES',
        check: (evidence) => (evidence.templateReferences?.length || 0) === 0,
        severity: 'CRITICAL',
        nodeId: 'dataConfig.templateReferences',
        title: 'No Templates Linked',
        rule: 'Company has no templateReferences. ScenarioPoolService returns 0 scenarios.',
        fix: 'Link a template in Data & Config → Template References',
        dbPath: 'aiAgentSettings.templateReferences',
        deepLinkSection: 'gapAnalysis'
    },
    {
        id: 'ZERO_SCENARIOS_LOADED',
        check: (evidence) => evidence.scenarioCount === 0 && (evidence.templateReferences?.length || 0) > 0,
        severity: 'HIGH',
        nodeId: 'dataConfig.scenarios',
        title: 'Templates Linked But 0 Scenarios Loaded',
        rule: 'Templates exist but ScenarioPoolService loaded 0 scenarios. Template may be empty or load failed.',
        fix: 'Check template content in Global AI Brain, or verify templateId is correct',
        dbPath: 'aiAgentSettings.templateReferences[].templateId',
        deepLinkSection: 'gapAnalysis'
    },
    {
        id: 'LLM_FALLBACK_NO_SCENARIOS',
        check: (evidence) => evidence.responseSource === 'LLM' && evidence.scenarioCount === 0,
        severity: 'CRITICAL',
        nodeId: 'dataConfig.templateReferences',
        title: 'LLM Fallback Due to Empty Scenario Pool',
        rule: 'Response came from LLM because scenarioCount=0. No scenarios to match against.',
        fix: 'Link a template with scenarios, or check if template load failed',
        dbPath: 'aiAgentSettings.templateReferences',
        deepLinkSection: 'gapAnalysis'
    },
    {
        id: 'LLM_FALLBACK_KILL_SWITCH',
        check: (evidence) => evidence.responseSource === 'LLM' && evidence.killSwitches?.forceLLMDiscovery === true,
        severity: 'CRITICAL',
        nodeId: 'frontDesk.discoveryConsent.forceLLMDiscovery',
        title: 'LLM Fallback Due to Kill Switch',
        rule: 'Response came from LLM because forceLLMDiscovery=true, not because no scenario matched.',
        fix: 'Disable forceLLMDiscovery to allow scenario auto-responses',
        dbPath: 'aiAgentSettings.frontDeskBehavior.discoveryConsent.forceLLMDiscovery',
        deepLinkSection: 'killSwitches'
    },
    
    // =========================================================================
    // BOOKING CONFIGURATION
    // =========================================================================
    {
        id: 'BOOKING_NO_SLOTS',
        check: (evidence) => evidence.mode === 'BOOKING' && (evidence.bookingSlots?.total || 0) === 0,
        severity: 'HIGH',
        nodeId: 'frontDesk.bookingSlots',
        title: 'Booking Mode Active But No Slots Configured',
        rule: 'AI entered BOOKING mode but no booking slots are configured.',
        fix: 'Configure booking slots in Front Desk → Booking Prompts',
        dbPath: 'aiAgentSettings.frontDeskBehavior.bookingSlots',
        deepLinkSection: 'actionQueue'
    },
    {
        id: 'BOOKING_INVALID_SLOTS',
        check: (evidence) => (evidence.bookingSlots?.invalid || 0) > 0,
        severity: 'MEDIUM',
        nodeId: 'frontDesk.bookingSlots',
        title: 'Booking Slots Missing Question Field',
        rule: 'Some booking slots lack the required "question" field and will be rejected at runtime.',
        fix: 'Add question field to all booking slots in Front Desk → Booking Prompts',
        dbPath: 'aiAgentSettings.frontDeskBehavior.bookingSlots[].question',
        deepLinkSection: 'actionQueue'
    },
    {
        id: 'BOOKING_CONSENT_BLOCKED',
        check: (evidence) => evidence.bookingRequiresConsent === true && evidence.consentGiven === false,
        severity: 'HIGH',
        nodeId: 'frontDesk.bookingSlots.bookingRequiresConsent',
        title: 'Booking Blocked by Consent Requirement',
        rule: 'bookingRequiresConsent=true but caller has not given consent.',
        fix: 'Either disable bookingRequiresConsent or ensure consent flow runs first',
        dbPath: 'aiAgentSettings.frontDeskBehavior.bookingSlots.bookingRequiresConsent',
        deepLinkSection: 'actionQueue'
    },
    
    // =========================================================================
    // GREETING INTERCEPT
    // =========================================================================
    {
        id: 'NO_GREETING_RESPONSES',
        check: (evidence) => evidence.isGreeting && (evidence.greetingResponsesCount || 0) === 0,
        severity: 'MEDIUM',
        nodeId: 'frontDesk.conversationStages.greeting',
        title: 'Greeting Detected But No Greeting Responses Configured',
        rule: 'Caller said a greeting but no greeting responses are configured.',
        fix: 'Configure greeting responses in Front Desk → Conversation Stages',
        dbPath: 'aiAgentSettings.frontDeskBehavior.conversationStages.greeting.responses',
        deepLinkSection: 'actionQueue'
    },
    
    // =========================================================================
    // REDIS / CACHE
    // =========================================================================
    {
        id: 'REDIS_CACHE_ERROR',
        check: (evidence) => evidence.redis?.error === true,
        severity: 'MEDIUM',
        nodeId: 'infra.scenarioPoolCache',
        title: 'Redis Cache Error',
        rule: 'ScenarioPoolService cache lookup failed. First requests will be slower.',
        fix: 'Check Redis connection in environment variables',
        dbPath: 'REDIS_URL',
        deepLinkSection: 'actionQueue'
    }
];

/**
 * Extract evidence from a debugSnapshot
 * Normalizes various debug formats into a standard evidence object
 * 
 * @param {Object} debugSnapshot - The debug object from test response
 * @returns {Object} Normalized evidence
 */
function extractEvidence(debugSnapshot) {
    if (!debugSnapshot) return {};
    
    const v22 = debugSnapshot.v22 || debugSnapshot.v22BlackBox || {};
    const slotDiag = debugSnapshot.slotDiagnostics || {};
    const bookingConfig = debugSnapshot.bookingConfig || {};
    
    return {
        // Response source
        responseSource: debugSnapshot.responseSource || 
                       (debugSnapshot.wasQuickAnswer ? 'QUICK_ANSWER' :
                        debugSnapshot.triageMatched ? 'TRIAGE' :
                        debugSnapshot.wasFallback ? 'FALLBACK' : 'LLM'),
        
        // Kill switches
        killSwitches: {
            forceLLMDiscovery: v22.forceLLMDiscovery || 
                              debugSnapshot.forceLLMDiscovery ||
                              v22.killSwitches?.forceLLMDiscovery,
            disableScenarioAutoResponses: v22.disableScenarioAutoResponses ||
                                          debugSnapshot.disableScenarioAutoResponses ||
                                          v22.killSwitches?.disableScenarioAutoResponses
        },
        
        // Scenarios
        scenarioCount: debugSnapshot.scenarioCount ?? v22.scenarioCount ?? null,
        triggersEvaluated: debugSnapshot.triggersEvaluated ?? v22.triggersEvaluated ?? null,
        
        // Templates
        templateReferences: debugSnapshot.templateReferences || [],
        templateId: debugSnapshot.templateId || v22.templateId,
        
        // Mode
        mode: debugSnapshot.mode || v22.mode || 'DISCOVERY',
        
        // Booking
        bookingSlots: {
            total: bookingConfig.slots?.length || slotDiag.totalSlots || 0,
            valid: slotDiag.validSlots || 0,
            invalid: slotDiag.rejectedSlots || 0
        },
        bookingRequiresConsent: bookingConfig.bookingRequiresConsent,
        consentGiven: debugSnapshot.consentGiven || slotDiag.consentGiven,
        
        // Greeting
        isGreeting: debugSnapshot.isGreeting || debugSnapshot.greetingDetected,
        greetingResponsesCount: debugSnapshot.greetingResponsesCount,
        
        // Redis
        redis: {
            hit: debugSnapshot.cacheHit,
            error: debugSnapshot.cacheError
        },
        
        // Config version
        effectiveConfigVersion: debugSnapshot.effectiveConfigVersion || v22.effectiveConfigVersion,
        
        // Raw for debugging
        _raw: debugSnapshot
    };
}

/**
 * Run deterministic diagnosis against evidence
 * Returns all matching issues with exact node references
 * 
 * @param {Object} evidence - Normalized evidence from extractEvidence()
 * @param {string} companyId - For deep links
 * @returns {Array} List of diagnostic items
 */
function runDiagnosis(evidence, companyId) {
    const issues = [];
    
    for (const rule of FAILURE_NODE_MAP) {
        try {
            if (rule.check(evidence)) {
                issues.push({
                    id: rule.id,
                    severity: rule.severity,
                    nodeId: rule.nodeId,
                    title: rule.title,
                    rule: rule.rule,
                    fix: rule.fix,
                    dbPath: rule.dbPath,
                    deepLink: `/control-plane-v2.html?companyId=${companyId}&tab=wiring&section=${rule.deepLinkSection}`,
                    evidence: extractRelevantEvidence(evidence, rule.id)
                });
            }
        } catch (e) {
            logger.warn(`[WIRING DIAGNOSTIC] Rule ${rule.id} check failed:`, e.message);
        }
    }
    
    // Sort by severity
    const severityOrder = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
    issues.sort((a, b) => (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99));
    
    return issues;
}

/**
 * Extract only the evidence relevant to a specific issue
 * This is what gets shown in the UI for that diagnostic item
 */
function extractRelevantEvidence(evidence, ruleId) {
    switch (ruleId) {
        case 'KILL_SWITCH_FORCE_LLM':
            return { forceLLMDiscovery: evidence.killSwitches?.forceLLMDiscovery };
        case 'KILL_SWITCH_DISABLE_SCENARIOS':
            return { disableScenarioAutoResponses: evidence.killSwitches?.disableScenarioAutoResponses };
        case 'NO_TEMPLATE_REFERENCES':
            return { templateReferences: evidence.templateReferences, count: evidence.templateReferences?.length || 0 };
        case 'ZERO_SCENARIOS_LOADED':
        case 'LLM_FALLBACK_NO_SCENARIOS':
            return { scenarioCount: evidence.scenarioCount, templateReferences: evidence.templateReferences?.length };
        case 'LLM_FALLBACK_KILL_SWITCH':
            return { responseSource: evidence.responseSource, forceLLMDiscovery: evidence.killSwitches?.forceLLMDiscovery };
        case 'BOOKING_NO_SLOTS':
        case 'BOOKING_INVALID_SLOTS':
            return { mode: evidence.mode, bookingSlots: evidence.bookingSlots };
        case 'BOOKING_CONSENT_BLOCKED':
            return { bookingRequiresConsent: evidence.bookingRequiresConsent, consentGiven: evidence.consentGiven };
        case 'NO_GREETING_RESPONSES':
            return { isGreeting: evidence.isGreeting, greetingResponsesCount: evidence.greetingResponsesCount };
        case 'REDIS_CACHE_ERROR':
            return { redis: evidence.redis };
        default:
            return {};
    }
}

/**
 * Generate PATCH JSON for actionable deltas
 * This is what can be pasted to get instant fix instructions
 * 
 * @param {Array} issues - Diagnostic issues
 * @param {Object} evidence - Evidence object
 * @param {string} companyId - Company ID
 * @returns {Object} PATCH JSON
 */
function generatePatchJson(issues, evidence, companyId) {
    return {
        _format: 'WIRING_DIAGNOSTIC_PATCH_V1',
        companyId,
        effectiveConfigVersion: evidence.effectiveConfigVersion || 'unknown',
        generatedAt: new Date().toISOString(),
        
        criticalIssues: issues
            .filter(i => i.severity === 'CRITICAL')
            .map(i => ({
                code: i.id,
                nodeId: i.nodeId,
                dbPath: i.dbPath,
                evidence: i.evidence,
                currentValue: i.evidence[Object.keys(i.evidence)[0]],
                recommendedValue: getRecommendedValue(i.id),
                fix: i.fix
            })),
        
        highIssues: issues
            .filter(i => i.severity === 'HIGH')
            .map(i => ({
                code: i.id,
                nodeId: i.nodeId,
                dbPath: i.dbPath,
                evidence: i.evidence,
                fix: i.fix
            })),
        
        mediumIssues: issues
            .filter(i => i.severity === 'MEDIUM')
            .map(i => ({
                code: i.id,
                nodeId: i.nodeId,
                dbPath: i.dbPath,
                evidence: i.evidence,
                fix: i.fix
            })),
        
        summary: {
            totalIssues: issues.length,
            critical: issues.filter(i => i.severity === 'CRITICAL').length,
            high: issues.filter(i => i.severity === 'HIGH').length,
            medium: issues.filter(i => i.severity === 'MEDIUM').length
        }
    };
}

/**
 * Get recommended value for a known issue
 */
function getRecommendedValue(ruleId) {
    const recommendations = {
        'KILL_SWITCH_FORCE_LLM': false,
        'KILL_SWITCH_DISABLE_SCENARIOS': false,
        'LLM_FALLBACK_KILL_SWITCH': false
    };
    return recommendations[ruleId] ?? null;
}

/**
 * MAIN ENTRY POINT: Diagnose a test response
 * Uses the actual debugSnapshot as evidence - no guessing.
 * 
 * @param {Object} debugSnapshot - The debug object from test response
 * @param {string} companyId - Company ID for deep links
 * @returns {Object} Full diagnostic result
 */
function diagnoseFromSnapshot(debugSnapshot, companyId) {
    const startTime = Date.now();
    
    // 1. Extract normalized evidence from the snapshot
    const evidence = extractEvidence(debugSnapshot);
    
    // 2. Run deterministic diagnosis
    const issues = runDiagnosis(evidence, companyId);
    
    // 3. Generate PATCH JSON for export
    const patchJson = generatePatchJson(issues, evidence, companyId);
    
    return {
        // Metadata
        companyId,
        generatedAt: new Date().toISOString(),
        generationTimeMs: Date.now() - startTime,
        
        // Health summary
        healthy: issues.filter(i => i.severity === 'CRITICAL').length === 0,
        
        // Evidence (what was observed)
        evidence: {
            responseSource: evidence.responseSource,
            mode: evidence.mode,
            scenarioCount: evidence.scenarioCount,
            killSwitches: evidence.killSwitches,
            templateReferences: evidence.templateReferences?.length || 0,
            bookingSlots: evidence.bookingSlots,
            effectiveConfigVersion: evidence.effectiveConfigVersion
        },
        
        // Diagnostic issues (deterministic)
        issues,
        
        // Summary counts
        summary: {
            total: issues.length,
            critical: issues.filter(i => i.severity === 'CRITICAL').length,
            high: issues.filter(i => i.severity === 'HIGH').length,
            medium: issues.filter(i => i.severity === 'MEDIUM').length
        },
        
        // Export formats
        patchJson
    };
}

/**
 * Quick check without full snapshot (for Wiring Tab standalone)
 * This calls the V2 wiring generator and extracts key diagnostics
 * 
 * @param {string} companyId - Company ID
 * @returns {Promise<Object>} Basic diagnostics
 */
async function getQuickDiagnostics(companyId) {
    const startTime = Date.now();
    
    try {
        // Use the V2 wiring generator - SINGLE SOURCE OF TRUTH
        const { generateWiringReport } = require('./wiringReportGenerator.v2');
        const wiringReport = await generateWiringReport(companyId);
        
        // Extract evidence from wiring report
        const evidence = {
            killSwitches: {
                forceLLMDiscovery: wiringReport.health?.killSwitches?.forceLLMDiscovery,
                disableScenarioAutoResponses: wiringReport.health?.killSwitches?.disableScenarioAutoResponses
            },
            scenarioCount: wiringReport.health?.scenarioCount || 0,
            templateReferences: wiringReport.dataMap?.templateReferences || [],
            bookingSlots: {
                total: wiringReport.health?.bookingSlots?.total || 0,
                valid: wiringReport.health?.bookingSlots?.valid || 0,
                invalid: wiringReport.health?.bookingSlots?.rejected || 0
            },
            effectiveConfigVersion: wiringReport.meta?.ecv
        };
        
        // Run diagnosis
        const issues = runDiagnosis(evidence, companyId);
        
        return {
            companyId,
            generatedAt: new Date().toISOString(),
            generationTimeMs: Date.now() - startTime,
            healthy: issues.filter(i => i.severity === 'CRITICAL').length === 0,
            evidence,
            issues,
            summary: {
                total: issues.length,
                critical: issues.filter(i => i.severity === 'CRITICAL').length,
                high: issues.filter(i => i.severity === 'HIGH').length,
                medium: issues.filter(i => i.severity === 'MEDIUM').length
            },
            // Include wiring scores for context
            wiringScores: {
                uiCoverage: wiringReport.health?.uiCoverage,
                dbCoverage: wiringReport.health?.dbCoverage,
                runtimeCoverage: wiringReport.health?.runtimeCoverage
            },
            // For deep inspection
            patchJson: generatePatchJson(issues, evidence, companyId)
        };
        
    } catch (error) {
        logger.error('[WIRING DIAGNOSTIC] Quick diagnostics failed', { companyId, error: error.message });
        
        return {
            companyId,
            generatedAt: new Date().toISOString(),
            generationTimeMs: Date.now() - startTime,
            healthy: false,
            error: error.message,
            issues: [{
                id: 'DIAGNOSTIC_ERROR',
                severity: 'HIGH',
                title: 'Diagnostic Error',
                rule: 'Failed to generate diagnostics',
                evidence: { error: error.message },
                fix: 'Check server logs'
            }],
            summary: { total: 1, critical: 0, high: 1, medium: 0 }
        };
    }
}

module.exports = {
    diagnoseFromSnapshot,
    getQuickDiagnostics,
    extractEvidence,
    runDiagnosis,
    generatePatchJson,
    FAILURE_NODE_MAP
};
