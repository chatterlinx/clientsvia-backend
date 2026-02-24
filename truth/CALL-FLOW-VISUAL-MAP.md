# 📞 CALL FLOW - VISUAL MAP
## Complete Turn-by-Turn Journey from Twilio Entry to Hangup

**Date:** February 24, 2026  
**Version:** 1.0.0  
**Purpose:** Visual representation of complete call flow for Call 2.0 development

---

## 🎯 CALL FLOW OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      TWILIO CALL ARRIVES                                │
│                    ↓ POST /api/v2/twilio/voice                         │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  TURN 0: CALL START                                                     │
│  ────────────────────────────────────────────────────────────────────── │
│  1. Lookup company by To phone number                                   │
│  2. Load company.aiAgentSettings.agent2                                 │
│  3. Initialize call state (StateStore/Redis)                            │
│  4. Compute awHash + effectiveConfigVersion                             │
│  5. Check callStart.enabled                                             │
│     ├─ TRUE  → Load callStart.text & callStart.audioUrl                │
│     └─ FALSE → Skip greeting, go straight to listen                    │
│  6. Validate greeting text (prevent code injection)                     │
│  7. Build TwiML:                                                        │
│     ├─ If audioUrl exists:                                              │
│     │    <Play>https://.../call-start.mp3</Play>                        │
│     └─ Else:                                                            │
│          <Say>Penguin Air! How can I help?</Say>                        │
│  8. <Gather input="speech" timeout="5">                                 │
│  9. Return TwiML to Twilio                                              │
│                                                                          │
│  State: { mode: "DISCOVERY", turn: 0, callerName: null }               │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                        CALLER SPEAKS: "Hi"
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  TURN 1: GREETING INTERCEPTOR CHECK                                     │
│  ────────────────────────────────────────────────────────────────────── │
│  ↓ POST /api/v2/twilio/gather (SpeechResult="hi")                      │
│                                                                          │
│  1. Receive STT result: "hi"                                            │
│  2. STT Preprocessing:                                                  │
│     ├─ Remove fillers (um, uh)                                          │
│     └─ Apply corrections (yeah → yes)                                   │
│  3. Check if interceptor.enabled = true                                 │
│  4. Short-Only Gate:                                                    │
│     ├─ Count words: 1 word                                              │
│     ├─ maxWords: 2                                                      │
│     └─ 1 ≤ 2? ✅ PASS                                                   │
│  5. Intent Word Blocking:                                               │
│     ├─ intentWords: ["repair", "AC", "broken", ...]                     │
│     ├─ "hi" contains any? NO                                            │
│     └─ ✅ PASS                                                           │
│  6. Load interceptor.rules (sorted by priority)                         │
│  7. Match rules:                                                        │
│     ┌──────────────────────────────────────────────────────────┐       │
│     │ Rule #1: priority=10, matchType=FUZZY                    │       │
│     │ triggers: ["hi", "hello", "hey"]                         │       │
│     │ Match: "hi" ~ "hi" → ✅ MATCH                            │       │
│     └──────────────────────────────────────────────────────────┘       │
│  8. Load rule.response: "Hi! How can I help you today?"                │
│  9. Check rule.audioUrl:                                                │
│     ├─ Exists? YES → <Play>https://.../rule-123.mp3</Play>            │
│     └─ No? → <Say>Hi! How can I help you today?</Say>                  │
│  10. <Gather input="speech" timeout="5">                                │
│  11. Return TwiML                                                       │
│                                                                          │
│  State: { mode: "DISCOVERY", turn: 1, lastGreeting: "rule-123" }      │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                    CALLER SPEAKS: "My AC is not cooling"
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  TURN 2: DISCOVERY ENGINE (TRIGGER MATCHING)                           │
│  ────────────────────────────────────────────────────────────────────── │
│  ↓ POST /api/v2/twilio/gather (SpeechResult="my ac is not cooling")   │
│                                                                          │
│  1. Receive STT: "my ac is not cooling"                                │
│  2. Check greeting interceptor:                                         │
│     ├─ Word count: 5 words                                              │
│     ├─ maxWords: 2                                                      │
│     └─ 5 > 2? → ❌ SKIP INTERCEPTOR                                     │
│  3. Enter Discovery Engine                                              │
│  4. Load active trigger group: "hvac"                                   │
│  5. Load local triggers                                                 │
│  6. Merge: globals + locals (locals override)                           │
│  7. Sort by priority (ascending = higher priority first)                │
│  8. Match triggers:                                                     │
│     ┌──────────────────────────────────────────────────────────┐       │
│     │ Trigger #1: hvac.tune_up (priority=20)                   │       │
│     │ ├─ Keywords: ["tune", "maintenance"]                     │       │
│     │ └─ Match: "my ac is not cooling" → ❌ NO MATCH           │       │
│     └──────────────────────────────────────────────────────────┘       │
│     ┌──────────────────────────────────────────────────────────┐       │
│     │ Trigger #2: hvac.ac_not_cooling (priority=10)            │       │
│     │ ├─ Keywords: ["ac", "not cooling"] → ✅ ALL FOUND        │       │
│     │ ├─ Negative: ["tune-up"] → ❌ NOT FOUND                  │       │
│     │ └─ ✅ MATCH!                                              │       │
│     └──────────────────────────────────────────────────────────┘       │
│  9. Load trigger response (Standard mode):                              │
│     ├─ answer.text: "Our AC repair service is $129..."                 │
│     └─ answer.audioUrl: "https://.../ac-not-cooling.mp3"               │
│  10. Load followup: "Would you like me to schedule a technician?"       │
│  11. Build TwiML:                                                       │
│      <Play>https://.../ac-not-cooling.mp3</Play>                        │
│      <Say>Would you like me to schedule a technician?</Say>            │
│      <Gather input="speech" timeout="5">                                │
│  12. Return TwiML                                                       │
│                                                                          │
│  State: {                                                               │
│    mode: "DISCOVERY",                                                   │
│    turn: 2,                                                             │
│    intent: "AC not cooling",                                            │
│    lastTrigger: "hvac.ac_not_cooling"                                   │
│  }                                                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                        CALLER SPEAKS: "Yes please"
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  TURN 3: BOOKING CONSENT DETECTION                                      │
│  ────────────────────────────────────────────────────────────────────── │
│  ↓ POST /api/v2/twilio/gather (SpeechResult="yes please")              │
│                                                                          │
│  1. Receive STT: "yes please"                                           │
│  2. Load consentPhrases: ["yes", "yeah", "sure", "ok", "yes please"]   │
│  3. Check match: "yes please" in list → ✅ MATCH                        │
│  4. Build handoff payload (AC1 contract):                               │
│     {                                                                    │
│       handoffContractVersion: "AC1",                                    │
│       companyId: "comp_abc123",                                         │
│       callSid: "CA1234...",                                             │
│       fromPhone: "+15551234567",                                        │
│       assumptions: {                                                    │
│         firstName: "Unknown",                                           │
│         lastName: ""                                                    │
│       },                                                                 │
│       summary: {                                                        │
│         issue: "AC not cooling",                                        │
│         serviceType: "hvac_repair",                                     │
│         urgency: "routine"                                              │
│       }                                                                  │
│     }                                                                    │
│  5. Store payload in call state                                         │
│  6. Switch mode: DISCOVERY → BOOKING                                    │
│  7. Build TwiML:                                                        │
│      <Say>Great! Let me get some information...</Say>                   │
│      <Gather input="speech" timeout="5">                                │
│  8. Return TwiML                                                        │
│                                                                          │
│  State: {                                                               │
│    mode: "BOOKING",                                                     │
│    turn: 3,                                                             │
│    bookingCtx: { issue: "AC not cooling", ... }                         │
│  }                                                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                    BOOKING ENGINE TAKES OVER
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  TURN 4-N: BOOKING FLOW                                                 │
│  ────────────────────────────────────────────────────────────────────── │
│                                                                          │
│  Turn 4: Ask for name                                                   │
│  ├─ Agent: "Can I get your first and last name?"                        │
│  └─ Caller: "John Smith"                                                │
│                                                                          │
│  Turn 5: Ask for preferred time                                         │
│  ├─ Agent: "When would you like us to come out?"                        │
│  └─ Caller: "Thursday afternoon"                                        │
│                                                                          │
│  Turn 6: Check Google Calendar availability                             │
│  ├─ Query: Thursday Feb 27, afternoon slots                             │
│  ├─ Available: 2 PM, 4 PM                                               │
│  └─ Agent: "I have 2 PM or 4 PM available. Which works better?"        │
│                                                                          │
│  Turn 7: Confirm time                                                   │
│  ├─ Caller: "2 PM is perfect"                                           │
│  ├─ Create appointment in calendar                                      │
│  └─ Agent: "You're all set! We'll see you Thursday at 2 PM."           │
│                                                                          │
│  Turn 8: Hangup                                                         │
│  └─ <Hangup/>                                                           │
│                                                                          │
│  Final State: {                                                         │
│    mode: "COMPLETED",                                                   │
│    turn: 8,                                                             │
│    appointment: {                                                       │
│      firstName: "John",                                                 │
│      lastName: "Smith",                                                 │
│      date: "2026-02-27",                                                │
│      time: "14:00",                                                     │
│      issue: "AC not cooling"                                            │
│    }                                                                     │
│  }                                                                       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔀 ALTERNATIVE FLOW: ESCALATION

```
                    CALLER SPEAKS: "I want to speak to a human"
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  ESCALATION PATH                                                        │
│  ────────────────────────────────────────────────────────────────────── │
│                                                                          │
│  1. Receive STT: "i want to speak to a human"                          │
│  2. Load escalationPhrases:                                             │
│     ["speak to a human", "talk to someone", "real person",             │
│      "operator", "representative"]                                      │
│  3. Check match: ✅ MATCHED "speak to a human"                          │
│  4. Load company.transferNumber: "+15551234567"                         │
│  5. Build TwiML:                                                        │
│      <Say>Let me connect you to our team.</Say>                         │
│      <Dial>+15551234567</Dial>                                          │
│  6. Transfer call                                                       │
│                                                                          │
│  State: { mode: "ESCALATED", turn: X, transferredTo: "+15551234567" }  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔀 ALTERNATIVE FLOW: LLM FACT PACK MODE

```
                    Trigger Match: pricing.maintenance_plan
                    Response Mode: LLM FACT PACK
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  LLM FACT PACK RESPONSE GENERATION                                      │
│  ────────────────────────────────────────────────────────────────────── │
│                                                                          │
│  1. Load trigger.llm:                                                   │
│     ┌────────────────────────────────────────────────────────┐         │
│     │ included:                                               │         │
│     │ - Two visits per year (spring and fall)                │         │
│     │ - Full system tune-up and inspection                   │         │
│     │ - Price: $179/year                                     │         │
│     │ - 15% discount on repairs                              │         │
│     │                                                         │         │
│     │ excluded:                                               │         │
│     │ - Drain line clearing ($89 separate)                   │         │
│     │ - Duct cleaning (needs estimate)                       │         │
│     └────────────────────────────────────────────────────────┘         │
│                                                                          │
│  2. Build LLM prompt:                                                   │
│     "Caller asked: 'Do you have a maintenance plan?'                    │
│      Using ONLY these facts, generate a 1-2 sentence response:          │
│      [included facts]                                                   │
│      [excluded facts]"                                                  │
│                                                                          │
│  3. Call OpenAI GPT-4                                                   │
│                                                                          │
│  4. Receive response:                                                   │
│     "Yes! Our maintenance plan is $179 per year and includes            │
│      two visits—one in spring and one in fall—with a full tune-up      │
│      and 15% off any repairs."                                          │
│                                                                          │
│  5. Convert to speech via ElevenLabs TTS                                │
│                                                                          │
│  6. Save audio to /public/audio/triggers/llm-{callSid}-{turn}.mp3      │
│                                                                          │
│  7. Build TwiML:                                                        │
│      <Play>https://.../llm-CA1234-2.mp3</Play>                         │
│      <Gather input="speech" timeout="5">                                │
│                                                                          │
│  8. Return TwiML                                                        │
│                                                                          │
│  ⚠️ FALLBACK PATH (if LLM fails):                                       │
│  ├─ Use trigger.llm.backup answer                                       │
│  └─ Convert to TTS, same flow                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 STATE TRANSITIONS

```
┌─────────────┐
│  CALL_START │
│   (Turn 0)  │
└──────┬──────┘
       │
       ▼
┌─────────────┐     greeting matched
│  GREETING   │────────────────────────────────┐
│  (Turn 1)   │                                │
└──────┬──────┘                                │
       │ no greeting match                     │
       │ (too many words or intent detected)   │
       ▼                                        │
┌─────────────┐                                │
│  DISCOVERY  │◄───────────────────────────────┘
│  (Turn 2+)  │
└──────┬──────┘
       │ consent detected
       ▼
┌─────────────┐
│   BOOKING   │
│  (Turn 3+)  │
└──────┬──────┘
       │ booking complete
       ▼
┌─────────────┐
│  COMPLETED  │
│  (Hangup)   │
└─────────────┘

PARALLEL PATH (any turn):
┌─────────────┐
│ ESCALATION  │──→ Transfer to human
│  (any turn) │
└─────────────┘
```

---

## 🎯 DECISION POINTS

### **Decision Point 1: Greeting Interceptor**
```
Input: "Hi my AC is broken"

CHECK 1: Word count
├─ Count: 4 words
├─ maxWords: 2
└─ 4 > 2 → ❌ SKIP INTERCEPTOR

CHECK 2: Intent words (if word count passed)
├─ intentWords: ["ac", "broken", "repair", ...]
├─ "Hi my AC is broken" contains "ac", "broken"
└─ ✅ SKIP INTERCEPTOR (caller has intent)

Result: Proceed to Discovery Engine
```

### **Decision Point 2: Trigger Matching**
```
Input: "My AC is not cooling"

Trigger #1: hvac.tune_up (priority=20)
├─ Keywords: ["tune", "maintenance"]
├─ Match: "My AC is not cooling" → NO "tune" or "maintenance"
└─ ❌ NO MATCH

Trigger #2: hvac.ac_not_cooling (priority=10)
├─ Keywords: ["ac", "not cooling"]
├─ Match: "My AC is not cooling" → "AC" ✓, "not cooling" ✓
├─ Negative: ["tune-up"]
├─ Match: "My AC is not cooling" → NO "tune-up"
└─ ✅ MATCH (first match wins)

Result: Execute trigger #2 response
```

### **Decision Point 3: Consent Detection**
```
Input: "Yes please"

CHECK: Consent phrases
├─ consentPhrases: ["yes", "yeah", "sure", "ok", "yes please"]
├─ "yes please" in list?
└─ ✅ YES

Result: Hand off to Booking Logic
```

---

## 🔍 DEBUGGING CHECKLIST

For Call 2.0, track these at each turn:

### **Turn Metadata**
- ✅ Turn number
- ✅ Timestamp
- ✅ Stage (CALL_START, GREETING, DISCOVERY, BOOKING, ESCALATED, COMPLETED)
- ✅ Caller input (raw STT)
- ✅ Preprocessed input (after filler removal)

### **Decision Trace**
- ✅ Greeting interceptor: checked? skipped? matched?
  - Word count gate result
  - Intent word blocking result
  - Rule match result (which rule, why)
- ✅ Discovery engine: entered? skipped?
  - Triggers evaluated (all of them, not just match)
  - Keywords found/missing
  - Negative keywords found/missing
  - First match (trigger ID)
- ✅ Consent detection: checked? matched?

### **Response Trace**
- ✅ Response type: greeting, trigger (standard), trigger (LLM), booking, escalation
- ✅ Text used
- ✅ Audio used (URL, cached, generated, stale)
- ✅ LLM call: made? succeeded? failed? backup used?
- ✅ Follow-up appended?

### **State Changes**
- ✅ Mode before turn
- ✅ Mode after turn
- ✅ Slots extracted
- ✅ Booking context updates

### **Configuration Proof**
- ✅ awHash
- ✅ effectiveConfigVersion
- ✅ Active trigger group ID
- ✅ Greetings enabled/disabled
- ✅ Consent phrases list
- ✅ Escalation phrases list

---

**END OF VISUAL MAP**

*This flow diagram represents the complete call journey with all decision points, states, and alternative paths for the ClientVia AI Agent system.*
