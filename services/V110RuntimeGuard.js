/**
 * V110RuntimeGuard.js
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * PERMANENT ENFORCEMENT LAYER — V110/V111 IS THE ONLY RUNTIME TRUTH
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This guard runs on every call and logs to BlackBox when any runtime path
 * strays outside V110/V111. It provides:
 * 
 *   1. V110_CONFIG_AUDIT  — Turn 1 snapshot: did this call start with V110 config?
 *   2. V110_RUNTIME_VIOLATION — Any booking/discovery/triage path that reads
 *      from a legacy source instead of V110/V111 canonical paths.
 * 
 * WHY: A year from now, if someone (human or AI coder) modifies the system
 * and accidentally introduces a legacy read path, this guard will fire on
 * every affected call, making the violation visible in BlackBox call review.
 * 
 * RULE: If it's not in V110/V111 UI, it does not exist at runtime.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');

const GUARD_VERSION = 'V110_GUARD_V1';

/**
 * Audit a company's config at call start (Turn 1).
 * Logs V110_CONFIG_AUDIT with a full snapshot of what's configured vs what's legacy.
 * If violations are found, also logs V110_RUNTIME_VIOLATION.
 * 
 * @param {Object} params
 * @param {Object} params.company - Company document
 * @param {string} params.callSid - Call SID
 * @param {string} params.companyId - Company ID
 * @param {Object} params.effectiveConfig - The aiAgentSettings loaded for this call
 */
function auditCallStart({ company, callSid, companyId, effectiveConfig }) {
    const frontDesk = effectiveConfig?.frontDeskBehavior || {};
    const violations = [];
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CHECK 1: Booking — slotRegistry + bookingFlow must exist
    // ═══════════════════════════════════════════════════════════════════════════
    const hasV110SlotRegistry = (frontDesk.slotRegistry?.slots?.length || 0) > 0;
    const hasV110BookingFlow = (frontDesk.bookingFlow?.steps?.length || 0) > 0;
    const bookingSource = hasV110SlotRegistry && hasV110BookingFlow ? 'V110' : 'NONE';
    
    if (bookingSource === 'NONE' && (hasV110SlotRegistry || hasV110BookingFlow)) {
        violations.push({
            area: 'BOOKING_PARTIAL',
            expected: 'frontDesk.slotRegistry + frontDesk.bookingFlow (both required)',
            actual: hasV110SlotRegistry ? 'slotRegistry only' : 'bookingFlow only',
            detail: 'V110 booking requires both slotRegistry AND bookingFlow to be configured'
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CHECK 2: Discovery — discoveryFlow must exist  
    // ═══════════════════════════════════════════════════════════════════════════
    const hasV110DiscoveryFlow = (frontDesk.discoveryFlow?.steps?.length || 0) > 0;
    
    if (!hasV110DiscoveryFlow) {
        // Not a violation if company just hasn't configured discovery yet
        // But flag it for visibility
        violations.push({
            area: 'DISCOVERY',
            expected: 'frontDesk.discoveryFlow.steps',
            actual: 'NOT_CONFIGURED',
            detail: 'Company has no V110 discovery flow configured',
            severity: 'warn'
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CHECK 3: Triage — must use frontDesk.triage.enabled as sole gate
    // ═══════════════════════════════════════════════════════════════════════════
    const triageConfig = frontDesk.triage || {};
    const hasV110Triage = triageConfig.engine === 'v110' || triageConfig.enabled !== undefined;
    
    // Check for stale modeSwitching.autoTriageOnProblem that differs from triage.autoOnProblem
    const msAutoTriage = frontDesk.modeSwitching?.autoTriageOnProblem;
    const v110AutoTriage = triageConfig.autoOnProblem;
    if (msAutoTriage !== undefined && v110AutoTriage !== undefined && msAutoTriage !== v110AutoTriage) {
        violations.push({
            area: 'TRIAGE_DRIFT',
            expected: 'triage.autoOnProblem is sole source',
            actual: `modeSwitching.autoTriageOnProblem=${msAutoTriage}, triage.autoOnProblem=${v110AutoTriage}`,
            detail: 'Legacy modeSwitching.autoTriageOnProblem conflicts with V110 triage.autoOnProblem'
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // LOG: V110_CONFIG_AUDIT — always, on every call start
    // ═══════════════════════════════════════════════════════════════════════════
    const audit = {
        guardVersion: GUARD_VERSION,
        bookingSource,
        hasV110SlotRegistry,
        hasV110BookingFlow,
        hasV110DiscoveryFlow,
        hasV110Triage,
        triageEnabled: !!triageConfig.enabled,
        violationCount: violations.filter(v => v.severity !== 'warn').length,
        warnCount: violations.filter(v => v.severity === 'warn').length,
        violations: violations.length > 0 ? violations : undefined
    };
    
    _logToBlackBox(callSid, companyId, 'V110_CONFIG_AUDIT', audit);
    
    // ═══════════════════════════════════════════════════════════════════════════
    // LOG: V110_RUNTIME_VIOLATION — only if real violations found
    // ═══════════════════════════════════════════════════════════════════════════
    const realViolations = violations.filter(v => v.severity !== 'warn');
    if (realViolations.length > 0) {
        logger.error('[V110 GUARD] 🚨 RUNTIME VIOLATION — call using non-V110 config', {
            callSid,
            companyId,
            violations: realViolations
        });
        
        _logToBlackBox(callSid, companyId, 'V110_RUNTIME_VIOLATION', {
            guardVersion: GUARD_VERSION,
            violations: realViolations,
            action: 'LOGGED_FOR_REVIEW'
        });
    }
    
    return {
        clean: realViolations.length === 0,
        violations,
        audit
    };
}

/**
 * Verify that a specific booking slot load came from V110.
 * Call this wherever booking slots are loaded at runtime.
 * 
 * @param {string} configSource - The source string (must be 'V110_SLOT_REGISTRY')
 * @param {string} callSid - Call SID
 * @param {string} companyId - Company ID
 * @param {string} caller - Which function loaded the slots (for stack tracing)
 */
function verifyBookingSource(configSource, callSid, companyId, caller) {
    if (configSource === 'V110_SLOT_REGISTRY') {
        return true; // Clean
    }
    
    logger.error('[V110 GUARD] 🚨 BOOKING_SOURCE_VIOLATION — slots loaded from non-V110 path', {
        callSid,
        companyId,
        configSource,
        caller,
        expected: 'V110_SLOT_REGISTRY'
    });
    
    _logToBlackBox(callSid, companyId, 'V110_RUNTIME_VIOLATION', {
        guardVersion: GUARD_VERSION,
        area: 'BOOKING_SOURCE',
        expected: 'V110_SLOT_REGISTRY',
        actual: configSource,
        caller,
        action: 'VIOLATION_LOGGED'
    });
    
    return false;
}

/**
 * Verify that triage is gated by frontDesk.triage.enabled only.
 * Call this wherever triage decisions are made.
 * 
 * @param {Object} effectiveConfig - The aiAgentSettings
 * @param {string} callSid
 * @param {string} companyId
 */
function verifyTriageGate(effectiveConfig, callSid, companyId) {
    const triageConfig = effectiveConfig?.frontDeskBehavior?.triage || {};
    
    // The only gate that matters
    const v110Enabled = triageConfig.enabled === true;
    
    return {
        allowed: v110Enabled,
        gate: 'frontDesk.triage.enabled',
        value: v110Enabled
    };
}

/**
 * Internal: Log to BlackBox (non-blocking, non-fatal)
 */
function _logToBlackBox(callSid, companyId, type, data) {
    try {
        const BlackBoxLogger = require('./BlackBoxLogger');
        if (BlackBoxLogger && BlackBoxLogger.logEvent) {
            BlackBoxLogger.logEvent({
                callId: callSid,
                companyId,
                type,
                data
            }).catch(() => {});
        }
    } catch (e) {
        // BlackBox is optional — guard must never crash calls
        logger.warn('[V110 GUARD] BlackBox unavailable, violation logged to stdout only');
    }
}

module.exports = {
    auditCallStart,
    verifyBookingSource,
    verifyTriageGate,
    GUARD_VERSION
};
