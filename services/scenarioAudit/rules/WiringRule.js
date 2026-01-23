/**
 * WiringRule - Checks scenario wiring (actions, flows, transfers)
 * 
 * Validates that scenarios are properly "wired" to DO something:
 * - actionType matches required fields (flowId, transferTarget, etc.)
 * - followUpMode matches required fields
 * - bookingIntent set correctly for booking scenarios
 * 
 * This is a DETERMINISTIC rule (no LLM cost).
 */

const BaseRule = require('./BaseRule');
const {
    ACTION_TYPES,
    FOLLOW_UP_MODES,
    ACTION_TYPE_REQUIREMENTS,
    FOLLOW_UP_MODE_REQUIREMENTS,
    SEVERITY,
    RULE_CATEGORIES
} = require('../constants');

class WiringRule extends BaseRule {
    constructor() {
        super();
        this.id = 'wiring';
        this.name = 'Wiring Validation';
        this.description = 'Ensures scenarios are properly connected to actions, flows, and transfers';
        this.severity = SEVERITY.ERROR;
        this.category = RULE_CATEGORIES.WIRING;
        this.costType = 'deterministic';
        this.enabledByDefault = true;
    }
    
    async check(scenario, context = {}) {
        const violations = [];
        
        // 1. Validate action type
        violations.push(...this._checkActionType(scenario));
        
        // 2. Validate action type requirements
        violations.push(...this._checkActionTypeRequirements(scenario));
        
        // 3. Validate follow-up mode
        violations.push(...this._checkFollowUpMode(scenario));
        
        // 4. Validate follow-up mode requirements
        violations.push(...this._checkFollowUpModeRequirements(scenario));
        
        // 5. Check booking intent consistency
        violations.push(...this._checkBookingIntent(scenario));
        
        return violations;
    }
    
    /**
     * Validate actionType is a known value
     */
    _checkActionType(scenario) {
        const violations = [];
        const actionType = scenario.actionType;
        
        if (actionType && !ACTION_TYPES.includes(actionType)) {
            violations.push(this.createViolation({
                field: 'actionType',
                value: actionType,
                message: `Unknown actionType: "${actionType}"`,
                suggestion: `Valid values: ${ACTION_TYPES.join(', ')}`,
                meta: { validValues: ACTION_TYPES }
            }));
        }
        
        return violations;
    }
    
    /**
     * Check that required fields exist for the action type
     */
    _checkActionTypeRequirements(scenario) {
        const violations = [];
        const actionType = scenario.actionType || 'REPLY_ONLY';
        const requirements = ACTION_TYPE_REQUIREMENTS[actionType];
        
        if (!requirements) return violations;
        
        // Check required fields
        for (const field of requirements.required || []) {
            const value = scenario[field];
            if (!value) {
                violations.push(this.createViolation({
                    field: field,
                    value: null,
                    message: `actionType="${actionType}" requires "${field}" but it's missing`,
                    suggestion: requirements.description,
                    meta: { actionType, requiredField: field }
                }));
            }
        }
        
        // Check forbidden fields (should be empty/null)
        for (const field of requirements.forbidden || []) {
            const value = scenario[field];
            if (value) {
                violations.push(this.createViolation({
                    field: field,
                    value: value,
                    message: `actionType="${actionType}" should not have "${field}" set`,
                    suggestion: `Remove ${field} or change actionType`,
                    meta: { actionType, forbiddenField: field }
                }));
            }
        }
        
        return violations;
    }
    
    /**
     * Validate followUpMode is a known value
     */
    _checkFollowUpMode(scenario) {
        const violations = [];
        const followUpMode = scenario.followUpMode;
        
        if (followUpMode && !FOLLOW_UP_MODES.includes(followUpMode)) {
            violations.push(this.createViolation({
                field: 'followUpMode',
                value: followUpMode,
                message: `Unknown followUpMode: "${followUpMode}"`,
                suggestion: `Valid values: ${FOLLOW_UP_MODES.join(', ')}`,
                meta: { validValues: FOLLOW_UP_MODES }
            }));
        }
        
        return violations;
    }
    
    /**
     * Check that required fields exist for the follow-up mode
     */
    _checkFollowUpModeRequirements(scenario) {
        const violations = [];
        const followUpMode = scenario.followUpMode || 'NONE';
        const requirements = FOLLOW_UP_MODE_REQUIREMENTS[followUpMode];
        
        if (!requirements) return violations;
        
        // Check required fields
        for (const field of requirements.required || []) {
            const value = scenario[field];
            if (!value) {
                violations.push(this.createViolation({
                    field: field,
                    value: null,
                    message: `followUpMode="${followUpMode}" requires "${field}" but it's missing`,
                    suggestion: requirements.description,
                    meta: { followUpMode, requiredField: field }
                }));
            }
        }
        
        return violations;
    }
    
    /**
     * Check booking intent is set correctly
     */
    _checkBookingIntent(scenario) {
        const violations = [];
        const actionType = scenario.actionType || 'REPLY_ONLY';
        const scenarioType = scenario.scenarioType || 'UNKNOWN';
        const bookingIntent = scenario.bookingIntent;
        
        // REQUIRE_BOOKING should have bookingIntent=true
        if (actionType === 'REQUIRE_BOOKING' && bookingIntent !== true) {
            violations.push(this.createViolation({
                field: 'bookingIntent',
                value: bookingIntent,
                message: 'actionType="REQUIRE_BOOKING" should have bookingIntent=true',
                suggestion: 'Set bookingIntent to true for booking scenarios',
                meta: { actionType, expected: true }
            }));
        }
        
        // BOOKING scenarioType should typically have bookingIntent=true
        if (scenarioType === 'BOOKING' && bookingIntent !== true) {
            violations.push(this.createViolation({
                field: 'bookingIntent',
                value: bookingIntent,
                message: 'scenarioType="BOOKING" should typically have bookingIntent=true',
                suggestion: 'Set bookingIntent to true or change scenarioType',
                meta: { scenarioType, expected: true }
            }));
        }
        
        return violations;
    }
}

module.exports = WiringRule;
