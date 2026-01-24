/**
 * ============================================================================
 * STATE EFFECTS PROCESSOR - Apply state changes after scenario execution
 * ============================================================================
 * 
 * This service processes the `effects` field from scenarios and applies
 * state changes to the conversation state.
 * 
 * SUPPORTED EFFECTS:
 * - setState: Set a state variable to a value
 * - increment: Increment a counter
 * - decrement: Decrement a counter
 * - setFlag: Set a boolean flag
 * - clearFlag: Clear a boolean flag
 * - appendToList: Add item to a list
 * - setTimestamp: Set a timestamp
 * 
 * EXAMPLE EFFECTS:
 * {
 *   "setState": "confirming",
 *   "increment": { "holdCount": 1 },
 *   "setFlag": { "hasProvidedName": true }
 * }
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

class StateEffectsProcessor {
    /**
     * Apply effects to conversation state
     * @param {Object} effects - Effects object from scenario
     * @param {Object} currentState - Current conversation state
     * @param {Object} context - Execution context (callId, companyId, etc.)
     * @returns {Object} - Updated state and applied effects log
     */
    applyEffects(effects, currentState = {}, context = {}) {
        if (!effects || typeof effects !== 'object' || Object.keys(effects).length === 0) {
            return { 
                state: currentState, 
                applied: [], 
                unchanged: true 
            };
        }
        
        const { callId, scenarioId } = context;
        const newState = { ...currentState };
        const applied = [];
        
        logger.info(`🔄 [STATE EFFECTS] Processing effects`, {
            callId,
            scenarioId,
            effectsKeys: Object.keys(effects)
        });
        
        // Process each effect type
        for (const [effectType, effectValue] of Object.entries(effects)) {
            try {
                switch (effectType.toLowerCase()) {
                    case 'setstate':
                    case 'state':
                        // Set the conversation state
                        // Can be a string (simple state) or object (multiple state vars)
                        if (typeof effectValue === 'string') {
                            newState.currentState = effectValue;
                            applied.push({ type: 'setState', key: 'currentState', value: effectValue });
                        } else if (typeof effectValue === 'object') {
                            for (const [key, val] of Object.entries(effectValue)) {
                                newState[key] = val;
                                applied.push({ type: 'setState', key, value: val });
                            }
                        }
                        break;
                        
                    case 'increment':
                        // Increment counters
                        if (typeof effectValue === 'object') {
                            for (const [key, amount] of Object.entries(effectValue)) {
                                const incrementBy = typeof amount === 'number' ? amount : 1;
                                newState[key] = (newState[key] || 0) + incrementBy;
                                applied.push({ type: 'increment', key, by: incrementBy, newValue: newState[key] });
                            }
                        }
                        break;
                        
                    case 'decrement':
                        // Decrement counters
                        if (typeof effectValue === 'object') {
                            for (const [key, amount] of Object.entries(effectValue)) {
                                const decrementBy = typeof amount === 'number' ? amount : 1;
                                newState[key] = (newState[key] || 0) - decrementBy;
                                applied.push({ type: 'decrement', key, by: decrementBy, newValue: newState[key] });
                            }
                        }
                        break;
                        
                    case 'setflag':
                    case 'flags':
                        // Set boolean flags
                        if (typeof effectValue === 'object') {
                            for (const [key, val] of Object.entries(effectValue)) {
                                newState[key] = Boolean(val);
                                applied.push({ type: 'setFlag', key, value: newState[key] });
                            }
                        } else if (typeof effectValue === 'string') {
                            // Simple flag name = set to true
                            newState[effectValue] = true;
                            applied.push({ type: 'setFlag', key: effectValue, value: true });
                        }
                        break;
                        
                    case 'clearflag':
                        // Clear boolean flags
                        if (typeof effectValue === 'string') {
                            newState[effectValue] = false;
                            applied.push({ type: 'clearFlag', key: effectValue });
                        } else if (Array.isArray(effectValue)) {
                            for (const key of effectValue) {
                                newState[key] = false;
                                applied.push({ type: 'clearFlag', key });
                            }
                        }
                        break;
                        
                    case 'appendtolist':
                    case 'append':
                        // Append to arrays
                        if (typeof effectValue === 'object') {
                            for (const [key, item] of Object.entries(effectValue)) {
                                if (!Array.isArray(newState[key])) {
                                    newState[key] = [];
                                }
                                newState[key].push(item);
                                applied.push({ type: 'appendToList', key, item, listLength: newState[key].length });
                            }
                        }
                        break;
                        
                    case 'settimestamp':
                    case 'timestamp':
                        // Set timestamps
                        if (typeof effectValue === 'string') {
                            newState[effectValue] = Date.now();
                            applied.push({ type: 'setTimestamp', key: effectValue, value: newState[effectValue] });
                        } else if (typeof effectValue === 'object') {
                            for (const key of Object.keys(effectValue)) {
                                newState[key] = Date.now();
                                applied.push({ type: 'setTimestamp', key, value: newState[key] });
                            }
                        }
                        break;
                        
                    case 'set':
                        // Generic set (any value)
                        if (typeof effectValue === 'object') {
                            for (const [key, val] of Object.entries(effectValue)) {
                                newState[key] = val;
                                applied.push({ type: 'set', key, value: val });
                            }
                        }
                        break;
                        
                    case 'clear':
                    case 'delete':
                        // Clear/delete keys
                        if (typeof effectValue === 'string') {
                            delete newState[effectValue];
                            applied.push({ type: 'clear', key: effectValue });
                        } else if (Array.isArray(effectValue)) {
                            for (const key of effectValue) {
                                delete newState[key];
                                applied.push({ type: 'clear', key });
                            }
                        }
                        break;
                        
                    default:
                        // Unknown effect type - treat as setState
                        newState[effectType] = effectValue;
                        applied.push({ type: 'custom', key: effectType, value: effectValue });
                        logger.debug(`[STATE EFFECTS] Custom effect type: ${effectType}`, { callId });
                }
            } catch (error) {
                logger.error(`❌ [STATE EFFECTS] Error processing effect: ${effectType}`, {
                    callId,
                    error: error.message,
                    effectValue
                });
            }
        }
        
        logger.info(`✅ [STATE EFFECTS] Applied ${applied.length} effects`, {
            callId,
            scenarioId,
            applied: applied.map(a => `${a.type}:${a.key}`),
            stateKeys: Object.keys(newState)
        });
        
        return {
            state: newState,
            applied,
            unchanged: applied.length === 0
        };
    }
    
    /**
     * Validate effects object
     * @param {Object} effects - Effects object to validate
     * @returns {Object} - { valid: boolean, issues: string[] }
     */
    validateEffects(effects) {
        const issues = [];
        
        if (!effects || typeof effects !== 'object') {
            return { valid: true, issues: [] }; // Empty effects are valid
        }
        
        const validEffectTypes = [
            'setstate', 'state', 'increment', 'decrement', 
            'setflag', 'flags', 'clearflag', 'appendtolist', 
            'append', 'settimestamp', 'timestamp', 'set', 
            'clear', 'delete'
        ];
        
        for (const [effectType, effectValue] of Object.entries(effects)) {
            const normalizedType = effectType.toLowerCase();
            
            // Check if it's a known type (custom types are allowed but logged)
            if (!validEffectTypes.includes(normalizedType)) {
                issues.push(`Unknown effect type: ${effectType} (will be treated as setState)`);
            }
            
            // Validate increment/decrement values
            if (normalizedType === 'increment' || normalizedType === 'decrement') {
                if (typeof effectValue === 'object') {
                    for (const [key, amount] of Object.entries(effectValue)) {
                        if (typeof amount !== 'number') {
                            issues.push(`${effectType}.${key} should be a number, got ${typeof amount}`);
                        }
                    }
                }
            }
        }
        
        return {
            valid: issues.length === 0,
            issues
        };
    }
}

// Export singleton instance
module.exports = new StateEffectsProcessor();
