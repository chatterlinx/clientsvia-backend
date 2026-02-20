/**
 * ============================================================================
 * BOOKING INVARIANTS - V96k
 * ============================================================================
 * 
 * Final safety checks before critical booking actions.
 * 
 * This is Layer 3 defense: invariant validation before CONFIRMATION.
 * 
 * PRINCIPLE: If we're about to show final confirmation, ALL required slots
 * must be valid. If not, gracefully rewind without crashing.
 * 
 * NO THROWS - only state updates and logging.
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const { validateSlotValue } = require('./BookingSlotValidator');

// Agent 2.0 uses CallLogger for trace events
let CallLogger;
try {
    CallLogger = require('../../CallLogger');
} catch (e) {
    logger.warn('[BOOKING INVARIANTS] CallLogger not available');
}

/**
 * ============================================================================
 * CHECK CONFIRMATION INVARIANT
 * ============================================================================
 * 
 * Before showing final confirmation, verify ALL required slots are valid.
 * 
 * If any slot is invalid:
 * - Nullify the slot
 * - Set currentStepId to that slot's step
 * - Emit BOOKING_STATE_INVALID event
 * - Return the rewind info (no throw!)
 * 
 * @param {Object} state - Current booking state
 * @param {Object} flow - Resolved booking flow
 * @returns {Object|null} { invalidSlot, stepId, reason } or null if all valid
 */
function checkConfirmationInvariant(state, flow) {
    const collected = state.bookingCollected || {};
    const callSid = state._traceContext?.callSid;
    const companyId = state._traceContext?.companyId;
    const turn = state._traceContext?.turn || 0;
    
    // Check each required step
    for (const step of flow.steps || []) {
        if (!step.required) continue;
        
        const fieldKey = step.fieldKey || step.id;
        const value = collected[fieldKey];
        
        if (!value) continue;  // Missing is not "invalid" - just missing
        
        // Validate the slot value
        const validation = validateSlotValue(fieldKey, value, state);
        
        if (!validation.valid) {
            // INVARIANT VIOLATION - State is invalid for confirmation
            logger.error('[BOOKING INVARIANTS] ❌ V96k: CONFIRMATION INVARIANT VIOLATED', {
                invalidSlot: fieldKey,
                invalidValue: typeof value === 'string' ? value.substring(0, 50) : value,
                reason: validation.reason,
                rejectedBy: validation.rejectedBy,
                currentStep: 'CONFIRMATION',
                action: 'REWIND_WITHOUT_THROW'
            });
            
            // Emit BOOKING_STATE_INVALID event
            if (CallLogger && callSid && companyId) {
                CallLogger.logEvent({
                    callId: callSid,
                    companyId,
                    turn,
                    type: 'BOOKING_STATE_INVALID',
                    data: {
                        currentStep: 'CONFIRMATION',
                        invalidSlot: fieldKey,
                        invalidValue: typeof value === 'string' ? value.substring(0, 50) : value,
                        reason: validation.reason,
                        rejectedBy: validation.rejectedBy,
                        allCollected: Object.keys(collected),
                        action: 'REWINDING_VIA_STATE_UPDATE'
                    }
                }).catch(() => {});
            }
            
            // Nullify invalid slot
            delete collected[fieldKey];
            delete state.bookingCollected?.[fieldKey];
            if (state.slots?.[fieldKey]) {
                delete state.slots[fieldKey];
            }
            if (state.confirmedSlots?.[fieldKey]) {
                delete state.confirmedSlots[fieldKey];
            }
            
            // Return rewind info (caller will handle state update)
            return {
                invalidSlot: fieldKey,
                invalidValue: value,
                reason: validation.reason,
                stepId: step.id,
                action: 'REWIND'
            };
        }
    }
    
    // All valid - proceed to confirmation
    return null;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    checkConfirmationInvariant
};
