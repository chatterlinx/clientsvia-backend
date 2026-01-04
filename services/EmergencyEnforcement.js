/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EMERGENCY ENFORCEMENT SERVICE
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE: Ensure EMERGENCY scenarios are handled with maximum safety
 * 
 * RULES (NON-NEGOTIABLE):
 * 1. EMERGENCY scenarios MUST have stopRouting = true
 * 2. When EMERGENCY matches, routing STOPS (no fallthrough to other scenarios)
 * 3. EMERGENCY action is always 'escalate' or 'transfer' (never just 'reply')
 * 4. EMERGENCY has priority 100 (highest)
 * 
 * WHAT THIS SERVICE DOES:
 * - checkAndEnforce(): Called after scenario match to enforce EMERGENCY behavior
 * - validateScenario(): Check if an EMERGENCY scenario is properly configured
 * - getEmergencyAction(): Return the correct action for EMERGENCY scenarios
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');

class EmergencyEnforcement {
    
    /**
     * Check if a matched scenario triggers emergency enforcement
     * Call this AFTER scenario matching, BEFORE returning the result
     * 
     * @param {Object} scenario - The matched scenario
     * @param {Object} result - The routing result to potentially modify
     * @returns {Object} - { enforced, action, reason, originalAction }
     */
    static checkAndEnforce(scenario, result = {}) {
        if (!scenario) {
            return { enforced: false, action: null, reason: 'no_scenario' };
        }
        
        const scenarioType = (scenario.scenarioType || '').toUpperCase();
        const stopRouting = scenario.stopRouting === true;
        const isEmergency = scenarioType === 'EMERGENCY';
        const isTransfer = scenarioType === 'TRANSFER';
        
        // ═══════════════════════════════════════════════════════════════════
        // EMERGENCY ENFORCEMENT
        // ═══════════════════════════════════════════════════════════════════
        if (isEmergency || (stopRouting && (isEmergency || isTransfer))) {
            const enforcement = {
                enforced: true,
                action: 'escalate',
                originalAction: result.action || 'continue',
                reason: isEmergency ? 'EMERGENCY_SCENARIO' : 'STOP_ROUTING_FLAG',
                stopRouting: true,
                priority: 100,
                metadata: {
                    scenarioId: scenario.scenarioId || scenario._id?.toString(),
                    scenarioName: scenario.name,
                    scenarioType,
                    transferTarget: scenario.transferTarget || null,
                    enforcedAt: new Date().toISOString()
                }
            };
            
            logger.warn('🚨 [EMERGENCY ENFORCEMENT] Triggered!', {
                scenarioId: enforcement.metadata.scenarioId,
                scenarioName: enforcement.metadata.scenarioName,
                scenarioType,
                stopRouting,
                action: enforcement.action
            });
            
            // Modify the result to reflect emergency action
            if (result) {
                result.action = enforcement.action;
                result.emergencyEnforcement = enforcement;
                result.stopRouting = true;
            }
            
            return enforcement;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // TRANSFER ENFORCEMENT (explicit stopRouting)
        // ═══════════════════════════════════════════════════════════════════
        if (stopRouting) {
            const enforcement = {
                enforced: true,
                action: scenario.transferTarget ? 'transfer' : 'escalate',
                originalAction: result.action || 'continue',
                reason: 'STOP_ROUTING_FLAG',
                stopRouting: true,
                metadata: {
                    scenarioId: scenario.scenarioId || scenario._id?.toString(),
                    scenarioName: scenario.name,
                    scenarioType,
                    transferTarget: scenario.transferTarget || null,
                    enforcedAt: new Date().toISOString()
                }
            };
            
            logger.info('🛑 [STOP ROUTING] Enforcement triggered', {
                scenarioId: enforcement.metadata.scenarioId,
                scenarioName: enforcement.metadata.scenarioName,
                action: enforcement.action
            });
            
            if (result) {
                result.action = enforcement.action;
                result.stopRoutingEnforcement = enforcement;
                result.stopRouting = true;
            }
            
            return enforcement;
        }
        
        return { enforced: false, action: null, reason: 'not_applicable' };
    }
    
    /**
     * Validate that an EMERGENCY scenario is properly configured
     * Returns issues if not enterprise-ready
     * 
     * @param {Object} scenario - The scenario to validate
     * @returns {Object} - { valid, issues, warnings }
     */
    static validateScenario(scenario) {
        const issues = [];
        const warnings = [];
        
        if (!scenario) {
            return { valid: false, issues: ['Scenario is null'], warnings: [] };
        }
        
        const scenarioType = (scenario.scenarioType || '').toUpperCase();
        const isEmergency = scenarioType === 'EMERGENCY';
        const isTransfer = scenarioType === 'TRANSFER';
        
        if (isEmergency) {
            // EMERGENCY MUST have stopRouting
            if (scenario.stopRouting !== true) {
                issues.push('EMERGENCY scenario MUST have stopRouting=true');
            }
            
            // EMERGENCY should have high priority
            if (typeof scenario.priority !== 'number' || scenario.priority < 90) {
                warnings.push(`EMERGENCY priority should be >= 90 (current: ${scenario.priority || 'undefined'})`);
            }
            
            // EMERGENCY should have proper handoff
            if (scenario.handoffPolicy !== 'always_on_keyword') {
                warnings.push(`EMERGENCY handoffPolicy should be 'always_on_keyword' (current: ${scenario.handoffPolicy || 'undefined'})`);
            }
        }
        
        if (isTransfer) {
            // TRANSFER should have stopRouting
            if (scenario.stopRouting !== true) {
                warnings.push('TRANSFER scenario should have stopRouting=true');
            }
            
            // TRANSFER should have a target
            if (!scenario.transferTarget) {
                warnings.push('TRANSFER scenario should have transferTarget configured');
            }
        }
        
        return {
            valid: issues.length === 0,
            issues,
            warnings,
            scenarioType,
            stopRouting: scenario.stopRouting === true
        };
    }
    
    /**
     * Get the correct action for an EMERGENCY scenario
     * 
     * @param {Object} scenario - The scenario
     * @param {Object} company - Company config (for escalation settings)
     * @returns {Object} - { action, transferTarget, escalationMessage }
     */
    static getEmergencyAction(scenario, company = {}) {
        const scenarioType = (scenario?.scenarioType || '').toUpperCase();
        
        // Default emergency action
        let action = 'escalate';
        let transferTarget = null;
        let escalationMessage = null;
        
        if (scenario?.transferTarget) {
            action = 'transfer';
            transferTarget = scenario.transferTarget;
        }
        
        // Check company-level emergency settings
        const emergencySettings = company?.aiAgentSettings?.frontDeskBehavior?.emergencyProtocol;
        if (emergencySettings) {
            if (emergencySettings.defaultAction) {
                action = emergencySettings.defaultAction;
            }
            if (emergencySettings.transferTarget) {
                transferTarget = emergencySettings.transferTarget;
                action = 'transfer';
            }
            if (emergencySettings.escalationMessage) {
                escalationMessage = emergencySettings.escalationMessage;
            }
        }
        
        return {
            action,
            transferTarget,
            escalationMessage,
            scenarioType,
            isEmergency: scenarioType === 'EMERGENCY'
        };
    }
    
    /**
     * Apply EMERGENCY enforcement to a routing result
     * This is a convenience method that combines check + apply
     * 
     * @param {Object} result - The routing result from IntelligentRouter
     * @param {Object} company - Company config
     * @returns {Object} - Modified result
     */
    static applyToResult(result, company = {}) {
        if (!result || !result.scenario) {
            return result;
        }
        
        const enforcement = this.checkAndEnforce(result.scenario, result);
        
        if (enforcement.enforced) {
            const emergencyAction = this.getEmergencyAction(result.scenario, company);
            
            result.action = emergencyAction.action;
            result.transferTarget = emergencyAction.transferTarget;
            result.escalationMessage = emergencyAction.escalationMessage;
            result.emergencyEnforcement = {
                ...enforcement,
                ...emergencyAction
            };
            
            logger.info('🚨 [EMERGENCY ENFORCEMENT] Applied to result', {
                routingId: result.routingId,
                scenarioId: result.scenario.scenarioId,
                action: result.action,
                transferTarget: result.transferTarget
            });
        }
        
        return result;
    }
}

module.exports = EmergencyEnforcement;

