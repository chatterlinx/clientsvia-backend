# Call Flow Sequence Trace Report
**Generated:** 2026-02-27  
**Purpose:** Verify agent is following the correct sequence through the system

## Expected Sequence (from User Request)

```
Twilio → Gatekeeper → Spam Filter → Greetings → Gather (Deepgram/TTS) → ScrabEngine → triggers.js
```

## Actual Sequence (Code Analysis)

### ✅ PHASE 1: Call Entry (`POST /api/twilio/voice`)
**File:** `routes/v2twilio.js:1004`

1. **Twilio Webhook Hit** (Line 1004-1048)
   - Entry point: `POST /api/twilio/voice`
   - Logs: CallSid, From, To
   - Looks up company by phone number

2. **✅ GATEKEEPER CHECK** (Line 1328-1417) 
   - **STATUS:** ✅ WIRED CORRECTLY
   - Checks `company.accountStatus.status`
   - Handles: `active`, `suspended`, `call_forward`
   - Logged in CallLogger as `GATEKEEPER_CHECK` event
   - **Location:** Lines 1328-1417

3. **✅ SPAM FILTER** (Line 1050-1116)
   - **STATUS:** ✅ WIRED CORRECTLY  
   - Uses `SmartCallFilter.checkCall()`
   - Logged as `SPAM_FILTER_CHECK` event
   - If blocked → hangup
   - If passed → continues
   - **Location:** Lines 1050-1116

4. **✅ GREETING GENERATION** (Line 1578-1947)
   - **STATUS:** ✅ WIRED CORRECTLY
   - Calls `initializeCall()` from V2 AI Agent Runtime
   - Gets greeting from Agent 2.0 or legacy config
   - Handles: prerecorded audio vs TTS
   - **Location:** Lines 1578-1947

5. **✅ GATHER (Deepgram STT Setup)** (Line 1644-1682)
   - **STATUS:** ✅ WIRED CORRECTLY
   - Creates `<Gather>` with:
     - `input: 'speech'`
     - `action: /api/twilio/v2-agent-respond/:companyId`
     - `enhanced: true`
     - `speechModel: 'phone_call'`
   - Logged as `GATHER_CONFIGURED` event
   - **Location:** Lines 1644-1699

---

### ✅ PHASE 2: User Response Processing (`POST /api/twilio/v2-agent-respond/:companyId`)
**File:** `routes/v2twilio.js:3523`

1. **STT Result Received** (Line 3523-3561)
   - Entry point from Twilio Gather
   - Gets `SpeechResult` (Deepgram transcript)
   - Logged as `DEEPGRAM_STT_RESULT` event
   - **Location:** Lines 3523-3561

2. **State Load** (Line 3725-3834)
   - Loads call state from Redis
   - Validates turn count
   - **Location:** Lines 3725-3834

3. **✅ CALLRUNTIME.PROCESSTURN** (Line 4154-4166)
   - **STATUS:** ✅ WIRED CORRECTLY
   - Main orchestrator call
   - Passes `speechResult` as user input
   - **Location:** Lines 4154-4166

---

### ✅ PHASE 3: CallRuntime Processing
**File:** `services/engine/CallRuntime.js`

1. **Runtime Ownership** (Line 318-328)
   - Section S1: Determines DISCOVERY vs BOOKING mode
   - Logged as `SECTION_S1_RUNTIME_OWNER`
   - **Location:** Lines 318-328

2. **Input Text Truth** (Line 333-345)
   - Section S2: Logs final input text
   - Logged as `INPUT_TEXT_SELECTED`
   - **Location:** Lines 333-345

3. **Route to Discovery** (Line 376-427)
   - **🔥 CRITICAL SECTION**
   - Checks `if (state.lane === 'BOOKING')` → BookingLogicEngine
   - **ELSE** → Agent2DiscoveryRunner
   - **Location:** Lines 376-449

4. **✅ AGENT2DISCOVERYRUNNER.RUN** (Line 396-404)
   - **STATUS:** ✅ WIRED CORRECTLY
   - This is where the main discovery logic runs
   - **Location:** Lines 396-404
   - **File:** `services/engine/agent2/Agent2DiscoveryRunner.js`

---

### ✅ PHASE 4: Agent2 Discovery Processing
**File:** `services/engine/agent2/Agent2DiscoveryRunner.js`

**🎯 ACTUAL SEQUENCE (VERIFIED FROM CODE):**

1. **✅ GREETING INTERCEPTOR** (Lines 516-583)
   - **STATUS:** ✅ RUNS FIRST, BEFORE SCRABENGINE
   - Checks for short greetings ("hi", "hello", "good morning")
   - Uses `Agent2GreetingInterceptor.evaluate()`
   - **⚠️ CRITICAL:** If matched → **returns immediately, EXITS FUNCTION**
   - **PROBLEM:** Never reaches ScrabEngine or Trigger Cards!
   - Logged as `A2_GREETING_EVALUATED` and `GREETING_INTERCEPTED`
   - **Location:** Lines 516-583

2. **✅ SCRABENGINE** (Lines 585-728)
   - **STATUS:** ✅ RUNS SECOND (only if greeting didn't match)
   - Calls `ScrabEngine.process()` with raw user input
   - Pipeline: Fillers → Vocabulary → Synonyms → Quality Gate
   - Extracts entities: firstName, lastName, phone, email, address
   - Stores in `nextState.agent2.scrabEngine.entities`
   - Logged as `SCRABENGINE_PROCESSED` and visual trace events
   - **Location:** Lines 585-728

3. **✅ TRIGGER CARDS MATCHING** (Lines 1468-1485)
   - **STATUS:** ✅ RUNS THIRD (only if greeting didn't match)
   - Calls `TriggerCardMatcher.getCompiledTriggers()` to load triggers
   - Calls `TriggerCardMatcher.match(normalizedInput, triggerCards, matchOptions)`
   - Uses normalized input from ScrabEngine
   - Logged as `A2_TRIGGER_EVAL`
   - **Location:** Lines 1468-1485

---

## 🚨 **ROOT CAUSE IDENTIFIED**

### **🔴 CRITICAL ISSUE: Greeting Interceptor Blocks ScrabEngine & Triggers**

**Location:** `Agent2DiscoveryRunner.js:516-583`

**THE PROBLEM:**

The greeting interceptor runs FIRST and **exits immediately** if it matches, preventing ScrabEngine and Trigger Cards from ever running:

```javascript
// Lines 516-583
const greetingResult = Agent2GreetingInterceptor.evaluate({
  input: input,
  config: greetingsConfig,
  turn: typeof turn === 'number' ? turn : 0,
  state: nextState
});

if (greetingResult.intercepted) {
    // 🚨 CRITICAL: RETURNS IMMEDIATELY, EXITS FUNCTION
    // ScrabEngine never runs (line 605)
    // TriggerCardMatcher never runs (line 1473)
    return {
        response: greetingResult.response,
        matchSource: 'AGENT2_DISCOVERY',
        state: nextState
    };
}

// ScrabEngine.process() at line 605 - NEVER REACHED if greeting matched
// TriggerCardMatcher.match() at line 1473 - NEVER REACHED if greeting matched
```

**ACTUAL EXECUTION FLOW:**

```
User says "hi" or "hello"
   ↓
Agent2GreetingInterceptor.evaluate() → matches
   ↓
return { response: "Hello! How can I help?" }  ← EXITS HERE
   ↓
❌ ScrabEngine.process() - NEVER RUNS
❌ TriggerCardMatcher.match() - NEVER RUNS
❌ Entity extraction - NEVER HAPPENS
❌ Trigger card matching - NEVER HAPPENS
```

**EXPECTED BEHAVIOR:**

All three should run in sequence for EVERY user input:
1. ✅ Greeting Interceptor (check if it's a greeting)
2. ✅ ScrabEngine (normalize text + extract entities)
3. ✅ Trigger Cards (match against trigger database)

**WHY THIS IS BROKEN:**

The greeting interceptor is designed as an "early exit" optimization to avoid processing costs when the user just says "hi". However, this breaks the expected flow because:

1. **No entity extraction** - If user says "hi my name is John", the name is never extracted
2. **No trigger matching** - If user says "hi I need emergency service", the emergency trigger never fires
3. **No normalization** - ScrabEngine vocabulary expansion never happens

**RECOMMENDED FIX:**

The greeting interceptor should **NOT return early**. Instead, it should:
1. Mark that a greeting was detected
2. Continue to ScrabEngine
3. Continue to Trigger Matching
4. THEN decide if we should respond with greeting vs trigger

Alternatively, greeting detection should run AFTER trigger matching with lower priority.

---

## ✅ VERIFIED CORRECT SEQUENCE (When Greeting Doesn't Match)

**When user input does NOT match greeting interceptor:**

```
1. Greeting Interceptor evaluates → NO MATCH
2. ScrabEngine.process() → normalizes text, extracts entities
3. TriggerCardMatcher.match() → matches against trigger database
4. Response generated from matched trigger
```

**This sequence is ✅ CORRECT and follows the expected flow.**

---

## ❌ BROKEN SEQUENCE (When Greeting Matches)

**When user input matches greeting ("hi", "hello", etc.):**

```
1. Greeting Interceptor evaluates → MATCH
2. IMMEDIATE RETURN ← EXITS FUNCTION
3. ScrabEngine - NEVER RUNS ❌
4. TriggerCardMatcher - NEVER RUNS ❌
5. Response: greeting response only
```

**This sequence is ❌ BROKEN and violates the expected flow.**

---

## RECOMMENDED NEXT STEPS

### Option 1: Remove Early Exit (Preferred)

Modify `Agent2DiscoveryRunner.js` lines 534-583 to NOT return early:

```javascript
// BEFORE (current - broken):
if (greetingResult.intercepted) {
    return {  // ❌ EARLY EXIT
        response: greetingResult.response,
        matchSource: 'AGENT2_DISCOVERY',
        state: nextState
    };
}

// AFTER (fixed):
if (greetingResult.intercepted) {
    // Mark greeting detected but don't exit
    nextState.agent2.discovery.greetingDetected = true;
    nextState.agent2.discovery.greetingResponse = greetingResult.response;
    // Continue to ScrabEngine and trigger matching...
}
```

Then later in the code, AFTER trigger matching, decide whether to use greeting response or trigger response based on priority.

### Option 2: Move Greeting Check After Triggers

Reorder the sequence so greeting detection runs AFTER trigger matching:

```
1. ScrabEngine.process()
2. TriggerCardMatcher.match()
3. If no trigger matched → check greeting interceptor
4. Return appropriate response
```

This ensures triggers always get a chance to match, with greeting as the fallback.

---

### Option 3: Allow Greeting + Trigger Combination

The greeting interceptor could be smart enough to detect greetings + intent:

- "hi" → greeting only
- "hi I need help" → greeting + trigger
- "hi I have an emergency" → greeting + emergency trigger

Then respond with: greeting acknowledgment + trigger response.

---

## SEQUENCE VERIFICATION CHECKLIST

- [x] Twilio entry point exists
- [x] Gatekeeper runs before greeting  
- [x] Spam filter runs before greeting
- [x] Greeting generation works (call start)
- [x] Gather/Deepgram setup correct
- [x] v2-agent-respond receives STT result
- [x] CallRuntime.processTurn is called
- [x] Agent2DiscoveryRunner.run is called
- [x] **ScrabEngine runs and extracts entities** ✅ VERIFIED (line 605)
- [x] **Trigger cards are matched** ✅ VERIFIED (line 1473)
- [x] **Sequence order is correct** ⚠️ **PARTIALLY CORRECT**

---

## 🎯 FINAL DIAGNOSIS

### ✅ **CORRECT WIRING (7/8 steps)**

The flow from **Twilio → Gatekeeper → Spam Filter → Greeting (call start) → Gather (Deepgram) → v2-agent-respond → CallRuntime → Agent2DiscoveryRunner** is **100% CORRECTLY WIRED**.

### ❌ **BROKEN STEP (1/8)**

**Agent2DiscoveryRunner greeting interceptor** (line 516) **EXITS EARLY** when it matches a greeting, preventing:
- ScrabEngine from running (line 605)
- Trigger Cards from matching (line 1473)
- Entity extraction from happening

### 📊 **ACTUAL SEQUENCE**

**When user says anything OTHER than "hi/hello":**
```
✅ Greeting Interceptor → no match → continues
✅ ScrabEngine.process() → normalizes + extracts
✅ TriggerCardMatcher.match() → finds triggers
✅ Response generated
```

**When user says "hi" or "hello":**
```
✅ Greeting Interceptor → MATCH
❌ IMMEDIATE RETURN (line 578)
❌ ScrabEngine - SKIPPED
❌ TriggerCardMatcher - SKIPPED
❌ Entity extraction - SKIPPED
```

---

## 🔧 RECOMMENDED FIX

**File:** `services/engine/agent2/Agent2DiscoveryRunner.js`  
**Lines:** 534-583

**Change:** Remove the early return, allow ScrabEngine and trigger matching to always run, then decide which response to use based on priority.

This ensures the agent follows the complete sequence for ALL user inputs, regardless of whether they start with a greeting.
