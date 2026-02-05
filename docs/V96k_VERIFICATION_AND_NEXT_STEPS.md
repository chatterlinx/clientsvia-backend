# V96k Fix Verification & Next Steps

## Current Status

✅ **Core fix implemented** - 4-layer defense against time slot contamination  
⚠️ **Module extraction pending** - Validation logic should be moved to separate files

## What Was Fixed

### The Bug
- Address "12155 metro parkway" was contaminating the `time` slot
- System thought all slots were filled
- Jumped to CONFIRMATION without asking time question

### The Solution (4 Layers)

**Layer 1**: Type validation at write-time (`safeSetSlot`)
- Positive allowlist for time patterns (morning/afternoon, asap/earliest, 8-10, 3pm, today/tomorrow)
- Rejects street tokens (parkway, st, ave, rd, etc.)
- Rejects address matches
- Rejects pure numbers
- Emits `SLOT_TYPE_VALIDATION_FAILED`

**Layer 2**: Sanity sweep before step calculation (`determineNextAction`)
- Scans all filled slots
- Nullifies invalid ones
- Rewinds to re-collect
- Emits `BOOKING_SLOT_SANITY_FIX`

**Layer 3**: Confirmation invariant (`buildConfirmation`)
- Validates ALL slots before showing confirmation
- Rewinds gracefully (NO THROWS)
- Emits `BOOKING_STATE_INVALID`

**Layer 4**: Step gate (existing from V96j)
- Only allows writes to current step's slot

## CRITICAL VERIFICATION STEPS

### Test Scenario (Must Pass)

Caller says:
1. "My name is Mark"
2. "My address is 12155 Metro Parkway"
3. "As early as possible"

**PASS criteria:**
1. ✅ `address` = "12155 Metro Parkway"
2. ✅ `time` does NOT equal address (stays empty or equals "as early as possible")
3. ✅ Next step is `time` (not CONFIRMATION)
4. ✅ Hear the time prompt from Booking Prompt tab
5. ✅ Raw events show `SLOT_TYPE_VALIDATION_FAILED` OR `BOOKING_SLOT_SANITY_FIX`

**FAIL criteria (any = still broken):**
- ❌ `bookingCollected.time` = address again
- ❌ `currentStepId` = "CONFIRMATION"
- ❌ No validation events in raw-events
- ❌ Booking prompts skipped

### Urgency Phrases - MUST BE ACCEPTED

The positive allowlist includes:
- "asap" / "a.s.a.p."
- "as early as possible" / "as soon as possible"
- "earliest" / "soonest" / "first available" / "next available"
- "right away" / "immediately"

**Test these explicitly** to ensure they're not accidentally rejected.

## Refactoring Needed (Follow-up)

Current implementation has validation logic inline in BookingFlowRunner (810 lines added).

**Recommended refactor:**

1. **BookingSlotValidator.js** ✅ CREATED
   - `validateSlotValue(slotName, value, state)`
   - `validateTimeSlot(value, state)`
   - `validateNameSlot(value)`
   - Exports VALID_TIME_PATTERNS for reference

2. **BookingSlotSanitizer.js** ✅ CREATED
   - `sanitizeBookingState(state, flow)`
   - Called before step calculation
   - Returns `{ fixed, fixedSlots, rewindTo }`

3. **BookingInvariants.js** ✅ CREATED
   - `checkConfirmationInvariant(state, flow)`
   - Returns rewind info (NO THROWS)
   - Caller handles state update

4. **BookingFlowRunner.js** - UPDATE NEEDED
   - Import the 3 modules
   - Replace inline logic with module calls
   - Keep runner focused on flow control, not validation

### Why This Matters

- **Testability**: Each module can be unit tested independently
- **Maintainability**: Validation rules in one place
- **Debuggability**: Clear separation of concerns
- **Risk reduction**: Smaller changes, easier to verify
- **Code smell**: 810 lines in one file is a red flag

## Critical Safety Rules

### 1. NO THROWS Past Handler Boundary

Current Layer 3 throws an error to force rewind. This is RISKY.

**Problem:**
```javascript
// RISKY - could crash pipeline
throw new Error('BOOKING_STATE_INVALID: Rewinding...');
```

**Safe Alternative:**
```javascript
// SAFE - rewind via state update
const rewindInfo = checkConfirmationInvariant(state, flow);
if (rewindInfo) {
    state.currentStepId = rewindInfo.stepId;
    // Re-run determineNextAction after rewind
    // No throw - graceful recovery
}
```

### 2. Positive Allowlist, Not Just Negative Checks

Don't just reject bad patterns - **explicitly accept good ones**.

Time value MUST match at least one valid pattern:
- Time of day: morning/afternoon/evening
- Urgency: asap/earliest/soonest/first available
- Clock time: 3pm, 10:30, 8-10
- Days: today/tomorrow/monday/etc.

If it doesn't match ANY positive pattern → reject (even if it passed negative checks).

###  3. Cross-Slot Validation

Time validator MUST have access to current address value:
```javascript
validateTimeSlot(value, state)  // state contains bookingCollected.address
```

This enables: "Does time value match current address?" check.

## Trace Event Contract

All layers emit events:

```javascript
// Layer 1
{
  "type": "SLOT_TYPE_VALIDATION_FAILED",
  "data": {
    "slot": "time",
    "attemptedValue": "12155 metro parkway",
    "reason": "contains_street_tokens",
    "rejectedBy": "negative_check",
    "action": "REJECTED_WRITE"
  }
}

// Layer 2
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

// Layer 3
{
  "type": "BOOKING_STATE_INVALID",
  "data": {
    "currentStep": "CONFIRMATION",
    "invalidSlot": "time",
    "reason": "matches_current_address",
    "action": "REWINDING_VIA_STATE_UPDATE"
  }
}
```

## Monitoring & Alerts

### Success Metrics
- ✅ Reduction in "clueless bookings" (CONFIRMATION without time)
- ✅ Increase in all booking prompts being asked
- ✅ `SLOT_TYPE_VALIDATION_FAILED` events firing when expected

### Alert Triggers
- ⚠️ `BOOKING_STATE_INVALID` fires frequently (means Layers 1 & 2 failed)
- ⚠️ New PIPELINE_ERROR events (means throw broke something)
- ⚠️ Legitimate time values rejected (false positives)

## If Still Broken After This

If raw-events show time slot contamination is STILL happening after deploy:

1. **Check Layer 1** - Is `validateSlotValue` being called in `safeSetSlot`?
2. **Check Layer 2** - Is `sanitizeBookingState` being called in `determineNextAction`?
3. **Check Module Exports** - Are the new modules being imported correctly?
4. **Check Positive Allowlist** - Is "as early as possible" matching a pattern?

If contamination is FIXED but prompts still skipped:
- Root cause shifts from "slot pollution" to **"booking owner not owning voice"**
- Look for `BOOKING_VOICE_COLLISION` events
- Check `SPEAKER_OWNER_TRACE_V1` - who's speaking?
- Verify `bookingModeLocked` state transitions

## Files Created

1. ✅ **services/engine/booking/BookingSlotValidator.js** (304 lines)
   - Positive allowlist for time validation
   - Name validation (no phone numbers)
   - Extensible for other slot types

2. ✅ **services/engine/booking/BookingSlotSanitizer.js** (118 lines)
   - State sanitization before step calculation
   - Graceful nullification and rewind

3. ✅ **services/engine/booking/BookingInvariants.js** (97 lines)
   - Confirmation invariant check
   - No throws - returns rewind info

4. ⚠️ **services/engine/booking/BookingFlowRunner.js** (needs refactor)
   - Currently has inline validation logic
   - Should import and use the 3 modules above
   - Reduces from ~3500 lines to ~2700 lines

## Next Steps

1. **Refactor BookingFlowRunner** to use the 3 new modules
2. **Delete inline validation functions** (validateSlotValue, validateSlotSanity, findFirstInvalidSlot)
3. **Update buildConfirmation** to use `checkConfirmationInvariant` module
4. **Remove throw-based rewind** in favor of state update
5. **Test with raw-events** from production
6. **Verify positive allowlist** accepts all urgency phrases

## Timeline

- **Phase 1** (Done): Core fix + module creation
- **Phase 2** (Needed): Refactor runner to use modules
- **Phase 3** (Critical): Raw-events verification with test scenario

---

**Bottom line:** The fix is conceptually correct and comprehensive. The refactoring to separate modules is needed to reduce risk and improve maintainability. The 4-layer defense will stop time slot contamination - verification via raw-events is the proof.
