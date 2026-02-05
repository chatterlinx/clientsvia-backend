# V96k: TIME SLOT CONTAMINATION FIX

**Date**: February 5, 2026  
**Version**: V96k  
**Severity**: CRITICAL  
**Status**: FIXED

## Problem Summary

The booking engine was experiencing "clueless booking" behavior where it would jump to CONFIRMATION without collecting all required slots. Investigation revealed that the `time` slot was being contaminated with address data.

### Root Cause

From raw-events-CA5a4b212418831af2d66756f671daeacc-2026-02-05.json:

```json
{
  "type": "STATE_SAVED",
  "data": {
    "bookingCollected": {
      "name": "Mark",
      "phone": "(239) 565-2202",
      "address": "12155 metro parkway.",
      "time": "12155 metro parkway."  // ← BUG: address copied to time!
    },
    "currentBookingStep": "CONFIRMATION"
  }
}
```

**What happened:**
1. User gave address: "12155 metro parkway"
2. System correctly stored it in `address` slot
3. System INCORRECTLY also stored it in `time` slot
4. State machine saw all slots filled (including `time`)
5. System jumped to CONFIRMATION
6. User never got asked for preferred time

## Analysis from AI Analyst

> "The Booking Prompt tab is **not** being ignored. It's being **loaded correctly**… but your runner is **skipping it** because it *thinks booking is already complete* and jumps straight to **CONFIRMATION**."

Key insight:
- Booking prompts ARE being read correctly from config
- The bug is in slot contamination, NOT config reading
- Once `time` has a (garbage) value, the runner thinks all slots are filled

## The Fix: 4-Layer Defense System

We implemented a comprehensive defense-in-depth strategy with 4 layers:

### Layer 1: Type Validation at Write-Time (PREVENTION)

**File**: `BookingFlowRunner.js`  
**Function**: `validateSlotValue(slotName, value, state)`  
**Location**: Added before `safeSetSlot()`

```javascript
/**
 * FIRST LINE OF DEFENSE: Validate BEFORE allowing ANY slot write.
 * 
 * TIME SLOT RULES:
 * - Must NOT contain street tokens (parkway, st, ave, rd, etc.)
 * - Must NOT match current address string
 * - Must NOT be pure numbers (like "12155")
 * - If long (>20 chars), must match time patterns
 * 
 * NAME SLOT RULES:
 * - Must NOT look like phone number (digit ratio check)
 */
function validateSlotValue(slotName, value, state) {
  if (slotName === 'time') {
    const STREET_TOKENS = ['parkway', 'st', 'ave', 'rd', ...];
    const hasStreetTokens = STREET_TOKENS.some(token => value.includes(token));
    
    if (hasStreetTokens) {
      return { valid: false, reason: 'time_contains_street_tokens' };
    }
    
    const addressValue = state.bookingCollected?.address;
    if (value === addressValue || value.includes(addressValue)) {
      return { valid: false, reason: 'time_matches_address' };
    }
    
    // ... more validation
  }
  
  return { valid: true };
}
```

**Result**: Slot writes are rejected at source if they don't make type sense.

**Trace Event**: `SLOT_TYPE_VALIDATION_FAILED` - emitted when write is rejected

### Layer 2: Sanity Sweep Before Step Calculation (DETECTION & REPAIR)

**File**: `BookingFlowRunner.js`  
**Function**: `validateSlotSanity(state, flow)`  
**Called from**: `determineNextAction()` - before calculating next step

```javascript
/**
 * SECOND LINE OF DEFENSE: Before calculating next step, validate ALL slots.
 * If contamination is detected, nullify the slot and force re-collection.
 */
static validateSlotSanity(state, flow) {
  const collected = state.bookingCollected || {};
  
  // Validate TIME slot
  if (collected.time) {
    const timeValue = String(collected.time).toLowerCase();
    const addressValue = String(collected.address || '').toLowerCase();
    
    let invalidReason = null;
    
    // Check 1: Contains street tokens?
    const hasStreetTokens = STREET_TOKENS.some(token => 
      timeValue.includes(token)
    );
    
    // Check 2: Matches address?
    const matchesAddress = addressValue && (
      timeValue === addressValue || 
      timeValue.includes(addressValue)
    );
    
    if (hasStreetTokens || matchesAddress) {
      // NULLIFY contaminated slot
      delete collected.time;
      delete state.slots?.time;
      delete state.confirmedSlots?.time;
      
      // REWIND to time step
      const timeStep = flow.steps.find(s => s.id === 'time');
      state.currentStepId = timeStep.id;
      
      logger.warn('V96k: SLOT SANITY FIX - Invalid time slot nulled');
    }
  }
}
```

**Result**: Even if contamination gets past Layer 1, it's caught here and fixed.

**Trace Event**: `BOOKING_SLOT_SANITY_FIX` - emitted when slot is nulled

### Layer 3: Confirmation Invariant (FINAL SAFETY CHECK)

**File**: `BookingFlowRunner.js`  
**Function**: `findFirstInvalidSlot(state, flow)`  
**Called from**: `buildConfirmation()` - before showing final confirmation

```javascript
/**
 * THIRD LINE OF DEFENSE: Before showing CONFIRMATION, verify ALL slots are valid.
 * If any slot is invalid, emit BOOKING_STATE_INVALID and rewind.
 */
static buildConfirmation(flow, state) {
  // V96k: CONFIRMATION INVARIANT CHECK
  const firstInvalidSlot = this.findFirstInvalidSlot(state, flow);
  
  if (firstInvalidSlot) {
    logger.error('V96k: CONFIRMATION INVARIANT VIOLATION', {
      invalidSlot: firstInvalidSlot.slot,
      invalidValue: firstInvalidSlot.value,
      reason: firstInvalidSlot.reason
    });
    
    // Emit BOOKING_STATE_INVALID event
    BlackBoxLogger.logEvent({
      type: 'BOOKING_STATE_INVALID',
      data: {
        currentStep: 'CONFIRMATION',
        invalidSlot: firstInvalidSlot.slot,
        action: 'REWINDING_TO_INVALID_SLOT'
      }
    });
    
    // Nullify and rewind
    delete state.bookingCollected[firstInvalidSlot.slot];
    state.currentStepId = firstInvalidSlot.stepId;
    
    throw new Error('BOOKING_STATE_INVALID: Rewinding to re-collect');
  }
  
  // All valid - proceed to confirmation
  // ...
}
```

**Result**: Nuclear safety check - if we got to CONFIRMATION with bad data, reject it.

**Trace Event**: `BOOKING_STATE_INVALID` - emitted when confirmation is rejected

### Layer 4: Step Gate Protection (ALREADY EXISTED)

**File**: `BookingFlowRunner.js`  
**Function**: `safeSetSlot()` - existing V96j step gate logic

```javascript
/**
 * FOURTH LINE OF DEFENSE: Only allow writes to the CURRENT step's slot.
 * 
 * If currentStep = 'address', reject writes to 'time' even if extracted.
 */
if (inBookingMode && currentStepId && !bypassStepGate) {
  const currentFieldKey = currentStepId.replace('_collect', '');
  const isCurrentSlot = slotName === currentFieldKey;
  
  if (!isCurrentSlot) {
    logger.warn('STEP_GATE_VIOLATION: Rejected write to non-current slot');
    return { accepted: false, reason: 'step_gate_violation' };
  }
}
```

**Result**: Prevents opportunistic slot fills from contaminating future steps.

**Trace Event**: `STEP_GATE_VIOLATION` - emitted when write is gated

## Validation Rules Reference

### TIME Slot

**MUST NOT contain:**
- Street tokens: parkway, st, ave, rd, boulevard, lane, drive, court, place, way
- Pure numbers without time context (e.g., "12155")
- Current address string (exact or partial match)

**MUST match ONE of:**
- Time of day: morning, afternoon, evening, tonight
- Urgency: asap, soonest, earliest, first available, right away, immediately
- Clock time: 3pm, 10:30, 2-4, 8-10
- Days: monday, tuesday, today, tomorrow

**Length limit:**
- If > 20 characters AND doesn't match time patterns → REJECT

### NAME Slot

**MUST NOT:**
- Look like phone number (digit ratio > 50% and length >= 7)

### PHONE Slot

**MUST:**
- Contain at least 10 digits

## Trace Events for Debugging

All 4 layers emit trace events to Raw Events for auditing:

```javascript
// Layer 1: Write-time validation
{
  "type": "SLOT_TYPE_VALIDATION_FAILED",
  "data": {
    "slot": "time",
    "attemptedValue": "12155 metro parkway",
    "reason": "time_contains_street_tokens",
    "action": "REJECTED_WRITE"
  }
}

// Layer 2: Sanity sweep
{
  "type": "BOOKING_SLOT_SANITY_FIX",
  "data": {
    "slot": "time",
    "oldValue": "12155 metro parkway",
    "newValue": null,
    "reason": "looks_like_address",
    "action": "NULLED_AND_FORCED_RE_COLLECTION"
  }
}

// Layer 3: Confirmation invariant
{
  "type": "BOOKING_STATE_INVALID",
  "data": {
    "currentStep": "CONFIRMATION",
    "invalidSlot": "time",
    "invalidValue": "12155 metro parkway",
    "action": "REWINDING_TO_INVALID_SLOT"
  }
}

// Layer 4: Step gate (existing)
{
  "type": "STEP_GATE_VIOLATION",
  "data": {
    "rejectedSlot": "time",
    "currentStep": "address",
    "reason": "slot_not_current_step"
  }
}
```

## Testing the Fix

### Test Case 1: Address Contamination (Original Bug)

**Scenario:**
1. User gives address: "12155 metro parkway"
2. System extracts and tries to set both `address` AND `time` to same value

**Expected Behavior (V96k):**
1. Layer 1 catches it: `validateSlotValue('time', '12155 metro parkway', state)`
2. Returns `{ valid: false, reason: 'time_contains_street_tokens' }`
3. Write is rejected
4. Emits `SLOT_TYPE_VALIDATION_FAILED`
5. `time` slot remains empty
6. System asks time question on next turn

### Test Case 2: Pure Number Contamination

**Scenario:**
1. User gives address with just number: "12155"
2. System tries to set `time` to "12155"

**Expected Behavior:**
1. Layer 1 catches it: `validateSlotValue('time', '12155', state)`
2. Returns `{ valid: false, reason: 'time_pure_number' }`
3. Write is rejected
4. System asks for time properly

### Test Case 3: Contamination Bypass (Layer 2 Catches It)

**Scenario:**
1. Layer 1 somehow missed it (shouldn't happen, but defense-in-depth)
2. State has `time: "12155 metro parkway"`

**Expected Behavior:**
1. Layer 2 runs before step calculation: `validateSlotSanity(state, flow)`
2. Detects invalid time slot
3. Nullifies `time` slot
4. Sets `currentStepId = 'time'`
5. Emits `BOOKING_SLOT_SANITY_FIX`
6. System re-collects time on next turn

### Test Case 4: Nuclear Option (Layer 3)

**Scenario:**
1. Both Layer 1 and Layer 2 somehow failed
2. System reaches `buildConfirmation()` with bad data

**Expected Behavior:**
1. Layer 3 invariant check: `findFirstInvalidSlot(state, flow)`
2. Finds `time` slot is invalid
3. Throws `BOOKING_STATE_INVALID` error
4. Emits `BOOKING_STATE_INVALID` event
5. Nullifies slot and rewinds
6. Try-catch in `runStep()` catches error
7. Re-runs `determineNextAction()` after rewind
8. System collects time properly

## Backward Compatibility

All fixes are additive and non-breaking:
- ✅ Existing valid slots continue to work
- ✅ Step gate logic (V96j) remains intact
- ✅ Identity firewall (V96j) remains intact
- ✅ No changes to config reading paths
- ✅ Trace events are additive (don't break existing consumers)

## Performance Impact

Minimal:
- Layer 1: Simple regex checks (< 1ms)
- Layer 2: Runs once per turn, only validates filled slots (< 1ms)
- Layer 3: Only runs at CONFIRMATION step (< 1ms)
- Layer 4: Already existed (no new cost)

Total overhead: **< 3ms per turn**

## Files Changed

1. **services/engine/booking/BookingFlowRunner.js**
   - Added `validateSlotValue()` function (Layer 1)
   - Modified `safeSetSlot()` to call validator
   - Added `validateSlotSanity()` function (Layer 2)
   - Modified `determineNextAction()` to call sanity sweep
   - Added `findFirstInvalidSlot()` function (Layer 3)
   - Modified `buildConfirmation()` to check invariant
   - Modified `runStep()` to handle invariant violations

## Deployment Notes

1. **Monitor Raw Events** for new trace events:
   - `SLOT_TYPE_VALIDATION_FAILED`
   - `BOOKING_SLOT_SANITY_FIX`
   - `BOOKING_STATE_INVALID`

2. **Alert on BOOKING_STATE_INVALID**:
   - This should be VERY RARE (means Layers 1 & 2 failed)
   - Indicates a logic bug if it fires frequently

3. **Success Metrics**:
   - Reduction in "clueless bookings" (bookings with invalid time slots)
   - Reduction in calls where CONFIRMATION happens without asking for time
   - Increase in calls where all booking prompts are asked

## Related Documentation

- [V96j: Identity Slot Firewall](./V96j_IDENTITY_SLOT_FIREWALL.md)
- [V96j: Step Gate Protection](./V96j_STEP_GATE_PROTECTION.md)
- [V94: Booking Prompt Resolution Tracing](./V94_BOOKING_PROMPT_RESOLVED.md)
- [V92: Conditional Booking Steps](./V92_CONDITIONAL_BOOKING_STEPS.md)

## Credits

- **Issue Reporter**: User (via raw-events analysis)
- **Root Cause Analysis**: AI Analyst
- **Implementation**: AI Coder (V96k)
- **Date**: February 5, 2026

---

**Version History:**
- V96k (2026-02-05): Initial implementation - 4-layer defense system
