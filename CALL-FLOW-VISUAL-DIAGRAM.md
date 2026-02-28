# Call Flow Visual Diagram
**Generated:** 2026-02-27  
**Purpose:** Visual representation of the call flow sequence

## 🎯 EXPECTED vs ACTUAL Flow

### ✅ EXPECTED FLOW (What User Requested)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CALL FLOW SEQUENCE                          │
└─────────────────────────────────────────────────────────────────────┘

    📞 Twilio Webhook
         │
         ├──> ✅ Gatekeeper Check
         │    (company status: active/suspended/forward)
         │
         ├──> ✅ Spam Filter
         │    (SmartCallFilter.checkCall)
         │
         ├──> ✅ Call Start Greeting
         │    (Agent 2.0 or legacy greeting)
         │
         ├──> ✅ Gather Setup (Deepgram STT)
         │    (action → /v2-agent-respond)
         │
         ↓
    🎧 User Speaks (Deepgram transcribes)
         │
         ├──> ✅ v2-agent-respond receives SpeechResult
         │
         ├──> ✅ CallRuntime.processTurn
         │
         ├──> ✅ Agent2DiscoveryRunner.run
         │
         ├──> 🔍 ScrabEngine.process()
         │    (normalize text, extract entities)
         │
         ├──> 🎯 TriggerCardMatcher.match()
         │    (match against trigger database)
         │
         └──> 💬 Response Generated
```

---

## ❌ ACTUAL FLOW (What's Broken)

### Scenario 1: User says "I need help" (NOT a greeting)

```
✅ WORKS CORRECTLY

    📞 Twilio → Gatekeeper → Spam Filter → Greeting → Gather
         ↓
    🎧 User: "I need help"
         ↓
    POST /v2-agent-respond
         ↓
    CallRuntime.processTurn
         ↓
    Agent2DiscoveryRunner.run
         ↓
    Greeting Interceptor → NO MATCH (not a greeting)
         ↓
    ✅ ScrabEngine.process()
         │  - Removes fillers
         │  - Expands vocabulary
         │  - Extracts entities
         ↓
    ✅ TriggerCardMatcher.match()
         │  - Finds "help" trigger
         │  - Returns help response
         ↓
    💬 "I'd be happy to help! What do you need?"
```

---

### Scenario 2: User says "Hi" (IS a greeting)

```
❌ BROKEN - EARLY EXIT

    📞 Twilio → Gatekeeper → Spam Filter → Greeting → Gather
         ↓
    🎧 User: "Hi"
         ↓
    POST /v2-agent-respond
         ↓
    CallRuntime.processTurn
         ↓
    Agent2DiscoveryRunner.run
         ↓
    Greeting Interceptor → ✅ MATCH (greeting detected!)
         │
         └──> 🚨 IMMEDIATE RETURN
              💬 "Hello! How can I help you?"
              
              ❌ ScrabEngine - NEVER RUNS
              ❌ TriggerCardMatcher - NEVER RUNS
              ❌ Entity extraction - NEVER HAPPENS
```

---

### Scenario 3: User says "Hi I have an emergency" (Greeting + Intent)

```
❌ BROKEN - MISSES EMERGENCY TRIGGER

    📞 Twilio → Gatekeeper → Spam Filter → Greeting → Gather
         ↓
    🎧 User: "Hi I have an emergency"
         ↓
    POST /v2-agent-respond
         ↓
    CallRuntime.processTurn
         ↓
    Agent2DiscoveryRunner.run
         ↓
    Greeting Interceptor → ✅ MATCH (detects "hi")
         │
         └──> 🚨 IMMEDIATE RETURN
              💬 "Hello! How can I help you?"
              
              ❌ ScrabEngine - NEVER RUNS (would have extracted "emergency")
              ❌ TriggerCardMatcher - NEVER RUNS (would have matched EMERGENCY trigger!)
              ❌ Emergency response - NEVER SENT
              
              🚨 CRITICAL: User has emergency, agent responds with generic greeting!
```

---

## 🔍 CODE ANALYSIS

### Where the Early Exit Happens

**File:** `services/engine/agent2/Agent2DiscoveryRunner.js`  
**Lines:** 534-583

```javascript
// Line 524: Evaluate greeting
const greetingResult = Agent2GreetingInterceptor.evaluate({
  input: input,
  config: greetingsConfig,
  turn: typeof turn === 'number' ? turn : 0,
  state: nextState
});

// Line 534: Check if greeting matched
if (greetingResult.intercepted) {
    // 🚨 PROBLEM: This returns immediately, skipping lines 605 and 1473
    
    // Line 578: EARLY EXIT
    return {
        response: greetingResult.response,  // Just the greeting response
        matchSource: 'AGENT2_DISCOVERY',
        state: nextState
    };
    // 🚨 Function exits here, never reaches code below
}

// Line 605: ScrabEngine - ONLY runs if greeting didn't match
const scrabResult = await ScrabEngine.process({ ... });

// Line 1473: Trigger matching - ONLY runs if greeting didn't match  
const triggerCards = await TriggerCardMatcher.getCompiledTriggers(...);
const triggerResult = TriggerCardMatcher.match(...);
```

---

## 🎯 THE FIX

### Current (Broken) Logic:

```
IF greeting detected:
    → return greeting response
    → EXIT (never check triggers)
ELSE:
    → run ScrabEngine
    → run trigger matching
    → return trigger response
```

### Fixed Logic (Option 1 - Recommended):

```
ALWAYS:
    → run ScrabEngine (extract entities, normalize)
    → run trigger matching
    
IF trigger matched:
    → return trigger response (higher priority)
ELSE IF greeting detected:
    → return greeting response (fallback)
ELSE:
    → return LLM fallback
```

### Fixed Logic (Option 2 - Alternative):

```
IF greeting detected AND input is SHORT (≤3 words) AND no intent words:
    → mark greeting detected but continue
    
ALWAYS:
    → run ScrabEngine
    → run trigger matching
    
IF trigger matched AND greeting detected:
    → return: greeting + trigger response
    → Example: "Hi! I see you have an emergency - let me connect you immediately."
ELSE IF trigger matched:
    → return trigger response only
ELSE IF greeting detected:
    → return greeting response only
```

---

## 📊 IMPACT ANALYSIS

### What Works Now ✅
- User says actual business intent → triggers match correctly
- Gatekeeper, spam filter, greeting work perfectly
- ScrabEngine and triggers work when greeting doesn't fire

### What's Broken Now ❌
- "Hi" → generic greeting (acceptable, but could be better)
- "Hi I need emergency service" → **MISSES EMERGENCY TRIGGER** ⚠️
- "Hello my name is John Smith" → **NEVER EXTRACTS NAME** ⚠️
- "Good morning I need an appointment" → **NEVER MATCHES APPOINTMENT TRIGGER** ⚠️

### What Will Work After Fix ✅
- "Hi" → greeting response (same as now)
- "Hi I need emergency service" → emergency trigger response ✅
- "Hello my name is John Smith" → extracts name + appropriate response ✅
- "Good morning I need an appointment" → booking flow starts ✅

---

## 🚨 SEVERITY ASSESSMENT

**Impact:** 🔴 **HIGH** - Critical business logic failures

**Affected Calls:** Any call where user starts with a greeting word

**Business Risk:** 
- Emergency calls may not be escalated properly
- Customer information may not be captured
- Booking appointments may be delayed
- User experience degraded (generic responses instead of contextual)

**Frequency:** MEDIUM-HIGH (many people naturally start calls with "hi" or "hello")

**Fix Complexity:** LOW (remove early return, adjust priority logic)

---

## ✅ SEQUENCE SUMMARY

| Step | Component | Status | Location |
|------|-----------|--------|----------|
| 1 | Twilio Entry | ✅ Working | `routes/v2twilio.js:1004` |
| 2 | Gatekeeper | ✅ Working | `routes/v2twilio.js:1328` |
| 3 | Spam Filter | ✅ Working | `routes/v2twilio.js:1050` |
| 4 | Call Start Greeting | ✅ Working | `routes/v2twilio.js:1578` |
| 5 | Gather (Deepgram) | ✅ Working | `routes/v2twilio.js:1644` |
| 6 | v2-agent-respond | ✅ Working | `routes/v2twilio.js:3523` |
| 7 | CallRuntime | ✅ Working | `services/engine/CallRuntime.js:293` |
| 8 | Agent2DiscoveryRunner | ✅ Working | `services/engine/agent2/Agent2DiscoveryRunner.js:396` |
| 9 | Greeting Interceptor | ⚠️ **EARLY EXIT** | `Agent2DiscoveryRunner.js:516` |
| 10 | ScrabEngine | ❌ **SKIPPED** if greeting matches | `Agent2DiscoveryRunner.js:605` |
| 11 | Trigger Matching | ❌ **SKIPPED** if greeting matches | `Agent2DiscoveryRunner.js:1473` |

**Overall Status:** 9/11 steps working correctly, 2 steps conditionally skipped when they shouldn't be.
