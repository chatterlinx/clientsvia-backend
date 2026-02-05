# V96k VERIFICATION - Raw Events Test

## The ONLY Test That Matters

**Caller script (DO EXACTLY THIS):**
1. "My name is Mark"
2. "My address is 12155 Metro Parkway"
3. "As early as possible"

Stop. No more. That's the test.

---

## PASS Criteria (ALL must be true)

### ✅ A) Address captured correctly
```json
{
  "slots": {
    "address": {
      "value": "12155 Metro Parkway"  // or normalized version
    }
  }
}
```

### ✅ B) Time slot NOT polluted
After address turn, `slots.time` must be:
- Empty/null, OR
- Set to "as early as possible" after time turn

**NEVER** equals address string.

### ✅ C) Rejection/repair event present
When address is spoken, ONE of these MUST appear:
```json
{
  "type": "SLOT_TYPE_VALIDATION_FAILED",
  "data": {
    "slot": "time",
    "attemptedValue": "12155 Metro Parkway",
    "reason": "contains_street_tokens" | "matches_current_address",
    "rejectedBy": "negative_check" | "contamination_check"
  }
}
```

OR

```json
{
  "type": "BOOKING_SLOT_SANITY_FIX",
  "data": {
    "slot": "time",
    "oldValue": "12155 Metro Parkway",
    "newValue": null,
    "reason": "looks_like_address"
  }
}
```

**If no rejection/repair event → validator not in write path.**

### ✅ D) currentStepId progression correct
After address captured:
```json
{
  "currentStepId": "time"  // or next required slot, NOT "CONFIRMATION"
}
```

### ✅ E) Spoken question from Booking Prompt tab
```json
{
  "type": "BOOKING_PROMPT_RESOLVED",
  "data": {
    "source": "bookingPromptTab" | "company_config"
  }
}
```

AND audio/TTS asks the time question from config.

---

## FAIL Criteria (if ANY is true)

### ❌ Fail 1: Time equals address
```json
{
  "slots": {
    "time": {
      "value": "12155 Metro Parkway"  // ← BUG STILL EXISTS
    }
  }
}
```

**Diagnosis:** Validator didn't run at write-time OR step gate bypass too permissive.

**Fix location:** Check `safeSetSlot()` - is `validateSlotValue()` being called?

---

### ❌ Fail 2: Premature CONFIRMATION
```json
{
  "currentStepId": "CONFIRMATION",
  "slots": {
    "time": null | invalid  // ← time missing or invalid but jumped to confirmation
  }
}
```

**Diagnosis:** "Filled" check is existence-based, not validation-based OR sanitizer not applied before step selection.

**Fix location:** Check `determineNextAction()` - is `sanitizeBookingState()` being called first?

---

### ❌ Fail 3: No rejection/repair events
Raw events have no:
- `SLOT_TYPE_VALIDATION_FAILED`
- `BOOKING_SLOT_SANITY_FIX`
- `BOOKING_STATE_INVALID`

**Diagnosis:** Modules exist but aren't wired into execution path, or tracing bypassed.

**Fix location:** Check module imports and function calls in BookingFlowRunner.

---

### ❌ Fail 4: Booking locked but wrong speaker
```json
{
  "bookingModeLocked": true,
  "responseOwner": "HYBRID_LLM" | "SCENARIO_ENGINE"  // ← NOT "BOOKING_FLOW_RUNNER"
}
```

**Diagnosis:** Competing speaker - state machine/LLM speaking while booking locked.

**Fix location:** Check `SPEAKER_OWNER_TRACE_V1` and routing logic. Look for `BOOKING_VOICE_COLLISION`.

---

## The Non-Negotiable Invariant

**Before showing CONFIRMATION, this MUST be enforced:**

```javascript
// In buildConfirmation(), before generating confirmation message:
const rewindInfo = checkConfirmationInvariant(state, flow);
if (rewindInfo) {
    // Invalid slot detected at CONFIRMATION gate
    // Clear it, rewind, keep runner owning voice
    // NO THROWS. NO UNLOCK.
    state.currentStepId = rewindInfo.stepId;
    return askRewindedStepPrompt();
}
```

If `currentStepId === "CONFIRMATION"` but ANY required slot fails validation:
- Clear invalid slot(s)
- Rewind to first invalid slot
- Emit `BOOKING_STATE_INVALID`
- Runner keeps voice ownership
- NO exceptions thrown
- NO unlock/fallthrough

---

## What to Upload for Verification

After running the 3-line test call, upload raw-events JSON containing:

1. `CALL_START` through `CALL_END`
2. All `TURN_TRACE` events
3. All `STATE_SAVED` events showing `bookingCollected` and `currentStepId`
4. All `SLOT_WRITE_*` events
5. All `BOOKING_*` events

If raw-events aren't available, provide:
- State dumps showing `slots`, `currentStepId`, `bookingModeLocked`
- TTS text showing what was actually said to caller
- Any error logs or warnings

---

## Results Interpretation

**If ALL 5 PASS criteria met:**
✅ Time slot contamination is fixed
✅ Booking prompts will be asked
✅ "As early as possible" is correctly accepted

**If ANY FAIL criteria met:**
❌ Bug still exists - diagnosis shows exact failure point
❌ Raw-events will show which layer failed (write-time, sanitization, invariant, or speaker)

---

## No More Features Until This Passes

**Hard stop on new development until:**
- 3-line test call produces PASS raw-events
- Time slot never contaminated with address
- Booking prompts asked from config
- All validation events present

Booking prompts issue lives or dies on what raw-events says. Not on code. Not on line counts. Not on documentation.

**Upload raw-events. That's the proof.**
