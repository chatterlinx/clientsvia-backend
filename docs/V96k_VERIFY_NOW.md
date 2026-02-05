# V96k - STOP. VERIFY. NOW.

## Test Call (Do Exactly This)
1. "My name is Mark"
2. "My address is 12155 Metro Parkway"
3. "As early as possible"

## PASS = All These True

✅ `slots.address` = "12155 Metro Parkway"  
✅ `slots.time` ≠ address (empty or "as early as possible")  
✅ `SLOT_TYPE_VALIDATION_FAILED` or `BOOKING_SLOT_SANITY_FIX` event appears  
✅ `currentStepId` = "time" after address (NOT "CONFIRMATION")  
✅ System asks time question from Booking Prompt tab  

## FAIL = Any of These

❌ `slots.time` = address → Validator not in write path  
❌ `currentStepId` = "CONFIRMATION" prematurely → Sanitizer not running  
❌ No validation events → Modules not wired  
❌ `responseOwner` ≠ "BOOKING_FLOW_RUNNER" → Speaker collision  

## What Changed

**Before:** 3,496 lines, inline validation, throws  
**After:** 3,160 lines (-336), 3 clean modules, no throws  

**Modules:**
- BookingSlotValidator (304 lines) - Positive allowlist
- BookingSlotSanitizer (118 lines) - State repair
- BookingInvariants (97 lines) - CONFIRMATION gate

**Inline functions deleted:** 0 remaining ✅

## Upload Raw Events

That's the proof. Not code. Not docs. Not line counts.

**Raw events from the 3-line call. Now.**
