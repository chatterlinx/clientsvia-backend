/**
 * ============================================================================
 * BOOKING SLOT SANITIZER - V96k
 * ============================================================================
 * 
 * Scans existing booking state for slot contamination and repairs it.
 * 
 * This is Layer 2 defense: detection and repair during step calculation.
 * 
 * Called before determineNextAction() to ensure state is clean before
 * we calculate which step to execute next.
 * 
 * PRINCIPLE: If contamination is detected, nullify the slot and rewind.
 * Don't crash - repair gracefully and log what happened.
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const { validateSlotValue } = require('./BookingSlotValidator');

// BlackBoxLogger for trace events
let BlackBoxLogger;
try {
    BlackBoxLogger = require('../../BlackBoxLogger');
} catch (e) {
    logger.warn('[BOOKING SLOT SANITIZER] BlackBoxLogger not available');
}

/**
 * ============================================================================
 * SANITIZE BOOKING STATE
 * ============================================================================
 * 
 * Scans all filled slots and validates them against their type.
 * If any slot contains invalid data (contamination), nullify it and rewind.
 * 
 * @param {Object} state - Current booking state
 * @param {Object} flow - Resolved booking flow (for finding step IDs)
 * @returns {Object} { fixed: boolean, fixedSlots: [], rewindTo: string|null }
 */
function sanitizeBookingState(state, flow) {
    const collected = state.bookingCollected || {};
    const callSid = state._traceContext?.callSid;
    const companyId = state._traceContext?.companyId;
    const turn = state._traceContext?.turn || 0;
    
    const fixedSlots = [];
    let rewindTo = null;
    
    // Scan each filled slot
    for (const [slotName, value] of Object.entries(collected)) {
        if (!value) continue;  // Skip empty slots
        
        // Validate the slot value
        const validation = validateSlotValue(slotName, value, state);
        
        if (!validation.valid) {
            // CONTAMINATION DETECTED - Nullify and track for rewind
            logger.warn('[BOOKING SLOT SANITIZER] ⚠️ V96k: Contaminated slot detected', {
                slot: slotName,
                invalidValue: typeof value === 'string' ? value.substring(0, 50) : value,
                reason: validation.reason,
                rejectedBy: validation.rejectedBy,
                callSid
            });
            
            // Find the step for this slot
            const step = flow?.steps?.find(s => 
                (s.fieldKey || s.id) === slotName || 
                s.type === slotName
            );
            
            // Nullify the contaminated slot
            delete collected[slotName];
            delete state.bookingCollected?.[slotName];
            if (state.slots?.[slotName]) {
                delete state.slots[slotName];
            }
            if (state.slotMetadata?.[slotName]) {
                delete state.slotMetadata[slotName];
            }
            if (state.confirmedSlots?.[slotName]) {
                delete state.confirmedSlots[slotName];
            }
            
            fixedSlots.push({
                slot: slotName,
                invalidValue: value,
                reason: validation.reason,
                stepId: step?.id
            });
            
            // Set rewind target to first invalid slot
            if (!rewindTo && step) {
                rewindTo = step.id;
            }
            
            // Emit trace event
            if (BlackBoxLogger && callSid && companyId) {
                BlackBoxLogger.logEvent({
                    callId: callSid,
                    companyId,
                    turn,
                    type: 'BOOKING_SLOT_SANITY_FIX',
                    data: {
                        slot: slotName,
                        oldValue: typeof value === 'string' ? value.substring(0, 50) : value,
                        newValue: null,
                        reason: validation.reason,
                        rejectedBy: validation.rejectedBy,
                        stepId: step?.id,
                        action: 'NULLED_AND_FORCED_RE_COLLECTION'
                    }
                }).catch(() => {});
            }
        }
    }
    
    // If we fixed any slots, update currentStepId to rewind
    if (rewindTo && fixedSlots.length > 0) {
        state.currentStepId = rewindTo;
        logger.info('[BOOKING SLOT SANITIZER] V96k: State sanitized, rewound to first invalid slot', {
            fixedCount: fixedSlots.length,
            rewindTo,
            fixedSlots: fixedSlots.map(f => f.slot)
        });
    }
    
    return {
        fixed: fixedSlots.length > 0,
        fixedSlots,
        rewindTo
    };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    sanitizeBookingState
};
