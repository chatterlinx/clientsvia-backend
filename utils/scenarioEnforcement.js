/**
 * ============================================================================
 * SCENARIO ENFORCEMENT - Enterprise Quality Gates
 * ============================================================================
 * 
 * RULES (NON-NEGOTIABLE):
 * 1. A scenario cannot be enabled unless enterpriseReady === true
 * 2. All scenario edits must re-run validation
 * 3. Runtime matching ignores non-enterprise-ready scenarios
 * 4. Penguin Air scenarios with enterpriseReady === true are blueprint candidates
 * 
 * NO EXCEPTIONS. NO OVERRIDES. NO TRUST.
 * 
 * ============================================================================
 */

const logger = require('./logger');
const { ALL_SCENARIO_TYPES, isAllowedScenarioType, isUnknownOrBlankScenarioType } = require('./scenarioTypes');

// ============================================================================
// QUALITY REQUIREMENTS - THE HARD RULES
// ============================================================================

const QUALITY_REQUIREMENTS = {
    minTriggers: 8,
    minNegativeTriggers: 3,
    minQuickReplies: 7,
    minFullReplies: 7,
    minReplyLength: 10
};

const SCENARIO_TYPE_ENUM = ALL_SCENARIO_TYPES;
const ACTION_TYPE_ENUM = ['REPLY_ONLY', 'START_FLOW', 'REQUIRE_BOOKING', 'TRANSFER', 'SMS_FOLLOWUP'];
const HANDOFF_POLICY_ENUM = ['never', 'low_confidence', 'always_on_keyword', 'emergency_only'];

// ============================================================================
// CORE VALIDATION FUNCTION
// ============================================================================

/**
 * Calculate if a scenario is enterprise-ready
 * This is the SINGLE SOURCE OF TRUTH for scenario quality
 * 
 * @param {Object} scenario - The scenario object
 * @param {Object} context - Optional context (flowIds, placeholderKeys)
 * @returns {Object} { enterpriseReady, grade, status, checks, issues, warnings }
 */
function validateScenarioQuality(scenario, context = {}) {
    const issues = [];
    const warnings = [];
    const checks = {};
    
    // ═══════════════════════════════════════════════════════════════════════
    // TRIGGER CHECKS
    // ═══════════════════════════════════════════════════════════════════════
    
    const triggers = scenario.triggers || [];
    checks.triggers = {
        count: triggers.length,
        min: QUALITY_REQUIREMENTS.minTriggers,
        pass: triggers.length >= QUALITY_REQUIREMENTS.minTriggers
    };
    if (!checks.triggers.pass) {
        issues.push(`triggers: ${triggers.length}/${QUALITY_REQUIREMENTS.minTriggers}`);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // NEGATIVE TRIGGER CHECKS
    // ═══════════════════════════════════════════════════════════════════════
    
    const negativeTriggers = scenario.negativeTriggers || [];
    checks.negativeTriggers = {
        count: negativeTriggers.length,
        min: QUALITY_REQUIREMENTS.minNegativeTriggers,
        pass: negativeTriggers.length >= QUALITY_REQUIREMENTS.minNegativeTriggers
    };
    if (!checks.negativeTriggers.pass) {
        issues.push(`negatives: ${negativeTriggers.length}/${QUALITY_REQUIREMENTS.minNegativeTriggers}`);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // REPLY CHECKS (ANTI-ROBOTIC)
    // ═══════════════════════════════════════════════════════════════════════
    
    const quickReplies = scenario.quickReplies || [];
    checks.quickReplies = {
        count: quickReplies.length,
        min: QUALITY_REQUIREMENTS.minQuickReplies,
        pass: quickReplies.length >= QUALITY_REQUIREMENTS.minQuickReplies
    };
    if (!checks.quickReplies.pass) {
        issues.push(`quickReplies: ${quickReplies.length}/${QUALITY_REQUIREMENTS.minQuickReplies}`);
    }
    
    const fullReplies = scenario.fullReplies || [];
    checks.fullReplies = {
        count: fullReplies.length,
        min: QUALITY_REQUIREMENTS.minFullReplies,
        pass: fullReplies.length >= QUALITY_REQUIREMENTS.minFullReplies
    };
    if (!checks.fullReplies.pass) {
        issues.push(`fullReplies: ${fullReplies.length}/${QUALITY_REQUIREMENTS.minFullReplies}`);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // SCENARIO TYPE CHECK
    // ═══════════════════════════════════════════════════════════════════════
    
    const scenarioType = scenario.scenarioType || 'UNKNOWN';
    checks.scenarioType = {
        value: scenarioType,
        valid: !isUnknownOrBlankScenarioType(scenarioType) && isAllowedScenarioType(scenarioType),
        pass: !isUnknownOrBlankScenarioType(scenarioType)
    };
    if (!checks.scenarioType.pass) {
        issues.push('scenarioType is blank/UNKNOWN');
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // WIRING CHECKS
    // ═══════════════════════════════════════════════════════════════════════
    
    const actionType = scenario.actionType || null;
    const flowId = scenario.flowId || null;
    const transferTarget = scenario.transferTarget || null;
    const stopRouting = scenario.stopRouting || false;
    
    const wiringIssues = [];
    
    // START_FLOW requires flowId
    if (actionType === 'START_FLOW' && !flowId) {
        wiringIssues.push('START_FLOW requires flowId');
    }
    
    // TRANSFER requires transferTarget
    if (actionType === 'TRANSFER' && !transferTarget) {
        wiringIssues.push('TRANSFER requires transferTarget');
    }
    
    // Validate flowId exists (if context provided)
    if (flowId && context.flowIds && !context.flowIds.includes(flowId.toString())) {
        wiringIssues.push(`flowId ${flowId} not found`);
    }
    
    // EMERGENCY/TRANSFER should have stopRouting
    if ((scenarioType === 'EMERGENCY' || scenarioType === 'TRANSFER') && !stopRouting) {
        warnings.push(`${scenarioType} should have stopRouting=true`);
    }
    
    checks.wiring = {
        actionType: actionType || 'inferred',
        flowId,
        transferTarget,
        stopRouting,
        issues: wiringIssues,
        pass: wiringIssues.length === 0
    };
    
    wiringIssues.forEach(w => issues.push(w));
    
    // ═══════════════════════════════════════════════════════════════════════
    // ENUM VALIDATION
    // ═══════════════════════════════════════════════════════════════════════
    
    const invalidEnums = [];
    if (actionType && !ACTION_TYPE_ENUM.includes(actionType)) {
        invalidEnums.push(`actionType: ${actionType}`);
    }
    if (scenario.handoffPolicy && !HANDOFF_POLICY_ENUM.includes(scenario.handoffPolicy)) {
        invalidEnums.push(`handoffPolicy: ${scenario.handoffPolicy}`);
    }
    
    checks.enums = {
        invalid: invalidEnums,
        pass: invalidEnums.length === 0
    };
    invalidEnums.forEach(e => issues.push(`Invalid enum: ${e}`));
    
    // ═══════════════════════════════════════════════════════════════════════
    // CALCULATE GRADE AND STATUS
    // ═══════════════════════════════════════════════════════════════════════
    
    const allPassed = [
        checks.triggers.pass,
        checks.negativeTriggers.pass,
        checks.quickReplies.pass,
        checks.fullReplies.pass,
        checks.scenarioType.pass,
        checks.wiring.pass,
        checks.enums.pass
    ];
    
    const passCount = allPassed.filter(p => p).length;
    const failCount = allPassed.length - passCount;
    
    // Calculate score
    let score = 100;
    if (!checks.triggers.pass) score -= 15;
    if (!checks.negativeTriggers.pass) score -= 10;
    if (!checks.quickReplies.pass) score -= 15;
    if (!checks.fullReplies.pass) score -= 15;
    if (!checks.scenarioType.pass) score -= 15;
    if (!checks.wiring.pass) score -= 20;
    if (!checks.enums.pass) score -= 10;
    score -= warnings.length * 2;
    score = Math.max(0, Math.min(100, score));
    
    // Grade
    let grade;
    if (score >= 90) grade = 'A';
    else if (score >= 80) grade = 'B';
    else if (score >= 65) grade = 'C';
    else if (score >= 50) grade = 'D';
    else grade = 'F';
    
    // Status
    let status;
    if (failCount === 0 && warnings.length <= 1) status = 'GREEN';
    else if (failCount <= 2) status = 'YELLOW';
    else status = 'RED';
    
    // ═══════════════════════════════════════════════════════════════════════
    // ENTERPRISE READY = ALL CRITICAL CHECKS PASS
    // ═══════════════════════════════════════════════════════════════════════
    
    const enterpriseReady = 
        checks.triggers.pass &&
        checks.negativeTriggers.pass &&
        checks.quickReplies.pass &&
        checks.fullReplies.pass &&
        checks.scenarioType.pass &&
        checks.wiring.pass &&
        checks.enums.pass;
    
    return {
        enterpriseReady,
        grade,
        score,
        status,
        passCount,
        failCount,
        checks,
        issues,
        warnings
    };
}

// ============================================================================
// RUNTIME FILTER - Only enterprise-ready scenarios match
// ============================================================================

/**
 * Filter scenarios for runtime matching
 * Only returns scenarios where enterpriseReady === true
 * 
 * @param {Array} scenarios - Array of scenario objects
 * @param {Object} context - Optional context (flowIds, placeholderKeys)
 * @returns {Array} Filtered scenarios that are enterprise-ready
 */
function filterEnterpriseReadyScenarios(scenarios, context = {}) {
    const ready = [];
    const rejected = [];
    
    for (const scenario of scenarios) {
        const validation = validateScenarioQuality(scenario, context);
        
        if (validation.enterpriseReady) {
            ready.push({
                ...scenario,
                _validation: validation
            });
        } else {
            rejected.push({
                scenarioId: scenario.scenarioId,
                name: scenario.name,
                reason: validation.issues.slice(0, 3).join(', '),
                grade: validation.grade
            });
        }
    }
    
    if (rejected.length > 0) {
        logger.warn(`[SCENARIO ENFORCEMENT] Filtered out ${rejected.length} non-enterprise-ready scenarios:`, 
            rejected.slice(0, 5).map(r => `${r.name}: ${r.reason}`)
        );
    }
    
    return ready;
}

// ============================================================================
// ENABLE GUARD - Block enabling non-ready scenarios
// ============================================================================

/**
 * Check if a scenario can be enabled
 * Throws error if not enterprise-ready
 * 
 * @param {Object} scenario - The scenario to check
 * @param {Object} context - Optional context
 * @throws {Error} If scenario is not enterprise-ready
 */
function assertCanEnable(scenario, context = {}) {
    const validation = validateScenarioQuality(scenario, context);
    
    if (!validation.enterpriseReady) {
        const error = new Error(
            `Cannot enable scenario "${scenario.name}": not enterprise-ready. ` +
            `Issues: ${validation.issues.join(', ')}. ` +
            `Grade: ${validation.grade}, Status: ${validation.status}`
        );
        error.code = 'SCENARIO_NOT_ENTERPRISE_READY';
        error.validation = validation;
        throw error;
    }
    
    return validation;
}

// ============================================================================
// SAVE VALIDATION - Re-run checks on every edit
// ============================================================================

/**
 * Validate scenario before save
 * Returns validation result (does not throw)
 * 
 * @param {Object} scenario - The scenario being saved
 * @param {Object} context - Optional context
 * @returns {Object} { canSave, validation, warnings }
 */
function validateBeforeSave(scenario, context = {}) {
    const validation = validateScenarioQuality(scenario, context);
    
    // Scenarios can always be saved (even if not enterprise-ready)
    // But we return the validation so the caller can:
    // 1. Show warnings in UI
    // 2. Prevent enabling if not ready
    // 3. Log the quality state
    
    return {
        canSave: true, // Always allow save (but with warnings)
        enterpriseReady: validation.enterpriseReady,
        validation,
        warnings: validation.enterpriseReady ? [] : [
            `Scenario "${scenario.name}" saved but NOT enterprise-ready`,
            `Grade: ${validation.grade}, Issues: ${validation.issues.length}`,
            ...validation.issues.slice(0, 5)
        ]
    };
}

// ============================================================================
// BLUEPRINT CANDIDATE CHECK
// ============================================================================

/**
 * Check if a scenario is a blueprint candidate
 * (Penguin Air scenarios with enterpriseReady === true)
 * 
 * @param {Object} scenario - The scenario
 * @param {String} companyId - The company ID
 * @param {String} penguinAirCompanyId - Penguin Air's company ID
 * @returns {Boolean}
 */
function isBlueprintCandidate(scenario, companyId, penguinAirCompanyId = '68e3f77a9d623b8058c700c4') {
    if (companyId !== penguinAirCompanyId) {
        return false;
    }
    
    const validation = validateScenarioQuality(scenario);
    return validation.enterpriseReady;
}

// ============================================================================
// BATCH VALIDATION
// ============================================================================

/**
 * Validate all scenarios and return summary
 * 
 * @param {Array} scenarios - Array of scenarios
 * @param {Object} context - Optional context
 * @returns {Object} Summary with counts and details
 */
function validateAllScenarios(scenarios, context = {}) {
    const results = scenarios.map(scenario => ({
        scenarioId: scenario.scenarioId,
        name: scenario.name,
        ...validateScenarioQuality(scenario, context)
    }));
    
    const enterpriseReady = results.filter(r => r.enterpriseReady);
    const notReady = results.filter(r => !r.enterpriseReady);
    
    const gradeDistribution = {
        A: results.filter(r => r.grade === 'A').length,
        B: results.filter(r => r.grade === 'B').length,
        C: results.filter(r => r.grade === 'C').length,
        D: results.filter(r => r.grade === 'D').length,
        F: results.filter(r => r.grade === 'F').length
    };
    
    return {
        total: scenarios.length,
        enterpriseReadyCount: enterpriseReady.length,
        notReadyCount: notReady.length,
        percentReady: scenarios.length > 0 
            ? Math.round(enterpriseReady.length / scenarios.length * 100) 
            : 0,
        gradeDistribution,
        topIssues: notReady
            .sort((a, b) => b.issues.length - a.issues.length)
            .slice(0, 10)
            .map(r => ({
                scenarioId: r.scenarioId,
                name: r.name,
                grade: r.grade,
                issues: r.issues.slice(0, 5)
            })),
        results
    };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // Constants
    QUALITY_REQUIREMENTS,
    SCENARIO_TYPE_ENUM,
    ACTION_TYPE_ENUM,
    HANDOFF_POLICY_ENUM,
    
    // Core validation
    validateScenarioQuality,
    
    // Enforcement
    filterEnterpriseReadyScenarios,
    assertCanEnable,
    validateBeforeSave,
    
    // Helpers
    isBlueprintCandidate,
    validateAllScenarios
};

