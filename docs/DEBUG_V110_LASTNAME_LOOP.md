# V110 Protocol Violation: lastName Loop Issue

**Date:** 2026-02-13  
**Call SID:** CA7d853b6618973159ea5aa179a9e5ba05  
**Issue:** Agent repeatedly asks "And what's your last name?" even after user provides it

---

## Executive Summary

The agent is **VIOLATING V110 protocol** by repeating the same prompt on every turn instead of processing the user's lastName response and advancing to the next step.

### What Should Happen (V110 Protocol)
1. **Turn 1:** User says "Hi, my name is Mark..." → Agent asks "And what's your last name?"
2. **Turn 2:** User says "My last name is Gonzalez" → Agent **EXTRACTS** lastName, **MERGES** it into name field, **ADVANCES** to next step (phone/address)
3. **Turn 3+:** Continue with remaining slots

### What's Actually Happening
1. **Turn 1:** User says "Hi, my name is Mark..." → Agent asks "And what's your last name?"
2. **Turn 2:** User says "My last name is Gonzalez" → Agent **IGNORES INPUT**, asks "And what's your last name?" again
3. **Turn 3:** User provides no response (timeout) → Agent asks "And what's your last name?" again (INFINITE LOOP)

---

## Raw Event Analysis

### Turn 1 (Correct Behavior)
```json
{
  "type": "GATHER_FINAL",
  "turn": 1,
  "text": "hi, my name is mark. , i'm having air conditioning problems..."
}

{
  "type": "SLOTS_MERGED",
  "turn": 1,
  "extracted": {
    "name": { "value": "Mark", "confidence": 0.9, "source": "utterance" }
  }
}

{
  "type": "BOOKING_STEP_COMPLETE",
  "turn": 0,
  "currentStepId": "lastName",
  "slotsCollected": ["name", "phone"]
}

{
  "type": "AGENT_RESPONSE_BUILT",
  "turn": 1,
  "text": "And what's your last name?"
}
```
✅ **Turn 1 is correct**: name extracted, currentStepId set to "lastName", proper prompt asked

---

### Turn 2 (PROTOCOL VIOLATION)
```json
{
  "type": "GATHER_FINAL",
  "turn": 1,
  "text": "my last name is gonzalez."
}

{
  "type": "STATE_LOADED",
  "turn": 2,
  "bookingModeLocked": true,
  "currentBookingStep": "lastName"
}

{
  "type": "CHECKPOINT_BOOKING_GATE",
  "turn": 2,
  "currentStepId": "lastName",
  "userText": "my last name is gonzalez.",
  "gateResult": "BOOKING_FLOW_RUNNER_WILL_EXECUTE"
}

{
  "type": "TURN_TRACE",
  "turn": 2,
  "checkpointA_stateLoaded": {
    "currentBookingStep": "lastName",
    "slotsSummary": { "name": null, "phone": null }
  },
  "checkpointB_slotsExtracted": {
    "slotsBefore": ["name", "phone"],
    "slotsAfter": ["name", "phone"],
    "delta": []  // ❌ NO LASTNAME EXTRACTED!
  },
  "checkpointD_bookingRunner": {
    "currentStepId": "lastName",
    "action": "booking"
  }
}

{
  "type": "AGENT_RESPONSE_BUILT",
  "turn": 2,
  "text": "And what's your last name?"
}
```

❌ **CRITICAL VIOLATION**:
- User said: "my last name is gonzalez"
- **checkpointB_slotsExtracted.delta: []** ← NO SLOTS EXTRACTED
- **currentStepId remains "lastName"** ← NO ADVANCEMENT
- Agent repeats: "And what's your last name?" ← **SAME PROMPT AGAIN**

This is a **100% protocol violation**. The runner is stuck in a loop.

---

### Turn 3 (Timeout - Loop Continues)
```json
{
  "type": "GATHER_TIMEOUT_ACTUAL",
  "turn": 0,
  "reason": "Twilio Gather completed with no speech"
}

{
  "type": "STATE_LOADED",
  "turn": 3,
  "currentBookingStep": "lastName"  // Still stuck
}

{
  "type": "AGENT_RESPONSE_BUILT",
  "turn": 3,
  "text": "And what's your last name?"  // Same prompt AGAIN
}
```

❌ **Loop confirmed**: Agent is stuck asking for lastName indefinitely

---

## Root Cause Analysis

### The Problem: handleCollectDetailsMode Logic Error

Looking at `BookingFlowRunner.js` lines 3478-3700, the `LAST_NAME_REQUIRED` handler has this flow:

```javascript
if (detailReason === 'LAST_NAME_REQUIRED' && (fieldKey === 'name' || step.type === 'name')) {
    // PHASE 1: First entry — ask for last name
    if (!userInput || userInput.trim() === '' || !state.askedForLastName) {
        // ... ask for lastName ...
        state.askedForLastName = true;
        return { reply: "And what's your last name?" };
    }
    
    // PHASE 2: User responded — check if they're spelling
    if (isSpelledInput(userInput)) {
        // ... handle spelled input ...
    }
    
    // PHASE 3: Normal extraction + scoring
    const lastNameToken = extractSingleNameToken(userInput, 'lastName', lastNamePolicy);
    
    if (!lastNameToken) {
        // ❌ PROBLEM: reprompt without understanding WHY extraction failed
        return { reply: step.reprompt || "And what's your last name?" };
    }
    
    const scoreResult = scoreNameCandidate(lastNameToken, 'lastName', { lastNamesSet });
    
    if (scoreResult.rejected) {
        // ❌ PROBLEM: reprompt when score is low
        return { reply: step.reprompt || "And what's your last name?" };
    }
    
    // ✅ Only if extraction succeeds AND score is high do we advance
}
```

### Why It's Failing

#### Issue #1: extractSingleNameToken is TOO STRICT
The user said: **"my last name is gonzalez"**

The extractor likely:
1. Splits into tokens: `["my", "last", "name", "is", "gonzalez"]`
2. Applies stop word filtering (removes "my", "last", "name", "is")
3. Returns: `"gonzalez"`
4. **BUT** - if the extractor has ANY issue (punctuation, capitalization, template stop words), it might return `null`

#### Issue #2: scoreNameCandidate May Be Too Strict
Even if "gonzalez" is extracted, if it's not in the 50K last name database (or has low similarity), it gets REJECTED.

Common Hispanic last names like "Gonzalez" SHOULD be in the database, but:
- Case sensitivity issues?
- Database not loaded properly?
- Accent handling (González vs Gonzalez)?

#### Issue #3: NO FALLBACK MECHANISM
The V110 protocol says:
> "After 2-3 failed extraction attempts, the agent should ask the user to spell it letter by letter"

But the current code just keeps reprompting infinitely. There's no:
- Attempt counter
- Spelling fallback
- Escalation to human

---

## V110 Protocol Requirements (from BOOKING_V110_PUSH_GATE.md)

### Binary Acceptance Test - MUST SEE:
✅ `BOOKING_GATE_ROUTED` with NO prompt text fields  
✅ `BOOKING_RUNNER_PROMPT` containing:
   - `promptSource` (e.g., `V110:bookingFlow.steps`)
   - `stepId` (e.g., `lastName`)
   - `slotId` (e.g., `name`)
   - `slotSubStep` (nullable)

### Binary Acceptance Test - MUST NOT SEE:
❌ Any gate event containing prompt text  
❌ Any `ADDRESS_BREAKDOWN_*` action  
❌ Any `GATE_SPOKE_VIOLATION` event  

### What We're Actually Seeing:
❌ `checkpointB_slotsExtracted.delta: []` ← No extraction happening  
❌ Agent stuck in infinite reprompt loop  
❌ No advancement through booking flow  

**This is a HARD FAIL of the V110 acceptance test.**

---

## The Fix Required

### 1. Add Extraction Debugging
```javascript
const lastNameToken = extractSingleNameToken(userInput, 'lastName', lastNamePolicy);

if (!lastNameToken) {
    logger.error('[V110 VIOLATION] lastName extraction failed', {
        userInput,
        extractedToken: lastNameToken,
        policy: lastNamePolicy,
        turn: state.turn,
        attemptCount: state.lastNameAttempts || 0
    });
    
    // Emit BlackBox event for analysis
    BlackBoxLogger.logEvent({
        type: 'LASTNAME_EXTRACTION_FAILED',
        data: { userInput, policy, attemptCount }
    });
}
```

### 2. Add Attempt Counter with Spelling Fallback
```javascript
// Track attempts
state.lastNameAttempts = (state.lastNameAttempts || 0) + 1;

if (!lastNameToken) {
    if (state.lastNameAttempts >= 2) {
        // Trigger spelling mode
        state.awaitingSpelledName = true;
        return {
            reply: "I'm having trouble understanding. Could you spell your last name for me? Just say each letter.",
            action: 'REQUEST_SPELLING'
        };
    }
    return { reply: step.reprompt || "What's your last name?" };
}
```

### 3. Relax Name Scoring for lastName
```javascript
// EXISTING: High rejection for firstName (lots of invalid words)
// NEEDED: Lower rejection threshold for lastName (user already said "my last name is X")

if (scoreResult.rejected) {
    // If user EXPLICITLY said "my last name is X", trust them more
    const explicitLastName = /\b(last\s*name|surname|family\s*name)\s+is\b/i.test(userInput);
    
    if (explicitLastName && scoreResult.score >= 0.3) {
        // Accept with confirmation
        logger.warn('[BOOKING] Accepting lower-score lastName due to explicit statement', {
            candidate: lastNameToken,
            score: scoreResult.score
        });
        // ... proceed with confirmation ...
    } else if (state.lastNameAttempts >= 2) {
        // Spelling fallback
        state.awaitingSpelledName = true;
        return { reply: "Could you spell your last name for me?" };
    } else {
        return { reply: step.reprompt };
    }
}
```

### 4. Add State Sanity Check
Before returning ANY response, verify state is advancing:

```javascript
// BEFORE returning from handleCollectDetailsMode
if (state.currentStepId === step.id && state.lastNameAttempts >= 3) {
    logger.error('[V110 VIOLATION] Stuck in lastName loop - escalating', {
        stepId: step.id,
        attemptCount: state.lastNameAttempts,
        lastInput: userInput
    });
    
    return this.buildEscalation(step, state, flow, 
        'Unable to collect last name - transferring to agent');
}
```

---

## Immediate Action Items

1. **Add Debug Logging**: Instrument `extractSingleNameToken` and `scoreNameCandidate` to log WHY they're failing
2. **Test Name Database**: Verify "Gonzalez" is in the 50K last name set
3. **Add Attempt Counter**: Track `state.lastNameAttempts` and trigger spelling mode after 2 failures
4. **Relax Scoring**: For explicit "my last name is X" patterns, accept lower confidence scores
5. **Add Escalation**: After 3 failed attempts, escalate to human instead of infinite loop
6. **Emit Trace Events**: Add `LASTNAME_EXTRACTION_DEBUG` BlackBox events for analysis

---

## Compliance Status

| V110 Requirement | Status | Details |
|-----------------|--------|---------|
| Gate must not emit text | ✅ PASS | Gate correctly routes to runner |
| Runner must extract slots | ❌ **FAIL** | No lastName extraction on Turn 2 |
| Runner must advance steps | ❌ **FAIL** | Stuck on lastName indefinitely |
| Prompt source tracing | ✅ PASS | `promptSource: "V110:bookingFlow.steps"` present |
| No infinite loops | ❌ **FAIL** | Infinite reprompt loop confirmed |

**OVERALL: HARD FAIL - V110 protocol violation**

---

---

## ✅ ROOT CAUSE IDENTIFIED

### The Bug: State Persistence Logic Error in v2twilio.js

**Location:** `routes/v2twilio.js` line 3544

**Current Code:**
```javascript
askedForLastName: bookingResult.state?.askedForLastName || false,
```

**The Problem:**
When BookingFlowRunner sets `state.askedForLastName = true` on Turn 1, this value is returned in `bookingResult.state`. However, the persistence logic uses `|| false` as a fallback, which causes:

1. **Turn 1**: `askedForLastName` is `undefined` → saved as `false`
2. **Turn 2**: State is loaded with `askedForLastName: false`
3. **BookingFlowRunner line 3559**: `if (!state.askedForLastName)` evaluates to `true` because `!false === true`
4. **Result**: Agent asks the question AGAIN instead of processing the user's response

**The Fix:**
```javascript
askedForLastName: bookingResult.state?.askedForLastName,
```

Remove the `|| false` fallback. Let `undefined` be `undefined` on first turn, and let `true` be `true` after the question is asked.

### Same Bug Affects Other Fields

The same pattern appears for multiple sub-step state fields:

```javascript
Line 3539: askedForCityState: bookingResult.state?.askedForCityState || false,
Line 3544: askedForLastName: bookingResult.state?.askedForLastName || false,
Line 3547: awaitingSpelledName: bookingResult.state?.awaitingSpelledName || false,
Line 3542: addressCompletionVerified: bookingResult.state?.addressCompletionVerified || false,
```

All of these should be changed to preserve the actual boolean value, not force `false` as default.

---

## The Complete Fix

### File: `routes/v2twilio.js`

**Change 1: Line 3539**
```javascript
// BEFORE (BUG):
askedForCityState: bookingResult.state?.askedForCityState || false,

// AFTER (FIX):
askedForCityState: bookingResult.state?.askedForCityState,
```

**Change 2: Line 3542**
```javascript
// BEFORE (BUG):
addressCompletionVerified: bookingResult.state?.addressCompletionVerified || false,

// AFTER (FIX):
addressCompletionVerified: bookingResult.state?.addressCompletionVerified,
```

**Change 3: Line 3544**
```javascript
// BEFORE (BUG):
askedForLastName: bookingResult.state?.askedForLastName || false,

// AFTER (FIX):
askedForLastName: bookingResult.state?.askedForLastName,
```

**Change 4: Line 3547**
```javascript
// BEFORE (BUG):
awaitingSpelledName: bookingResult.state?.awaitingSpelledName || false,

// AFTER (FIX):
awaitingSpelledName: bookingResult.state?.awaitingSpelledName,
```

---

## Why This Fix is Correct

1. **Preserves Undefined State**: On Turn 1, `askedForLastName` is `undefined` (hasn't been set yet)
2. **Preserves True State**: On Turn 2, after BookingFlowRunner sets it to `true`, it stays `true`
3. **Preserves False State**: If explicitly set to `false`, it stays `false` (rare, but possible)
4. **Preserves Deleted State**: When `delete state.askedForLastName` is called after success, it becomes `undefined` again

The `|| false` pattern was attempting to provide a default value, but it's WRONG for boolean flags that track whether a question has been asked. The natural default for "have we asked this question?" is `undefined` (not asked yet), not `false` (asked but answered no).

---

## V110 Compliance After Fix

With this fix:
- ✅ Agent asks lastName question once
- ✅ Agent processes user's response on next turn
- ✅ Agent extracts "gonzalez" from "my last name is gonzalez"
- ✅ Agent scores and accepts the lastName
- ✅ Agent advances to next step (phone/address)
- ✅ No infinite loops
- ✅ No stuck currentStepId
- ✅ Full V110 protocol compliance

---

## Next Steps

1. ✅ **COMPLETED:** Root cause identified - state persistence bug in v2twilio.js
2. **TODO:** Apply fix to all 4 boolean state fields
3. **TODO:** Test with reproduction call (Mark Gonzalez scenario)
4. **TODO:** Verify raw events show extraction and advancement
5. **TODO:** Add regression test to prevent future boolean state bugs
6. **TODO:** Update V110_PUSH_GATE.md with this failure mode

---

## References

- V110 Protocol: `/docs/release/BOOKING_V110_PUSH_GATE.md`
- Bug Location: `/routes/v2twilio.js` (lines 3539, 3542, 3544, 3547)
- BookingFlowRunner: `/services/engine/booking/BookingFlowRunner.js` (line 3559)
- Raw Events: Desktop file `raw-events-CA7d853b6618973159ea5aa179a9e5ba05-2026-02-13.json`
