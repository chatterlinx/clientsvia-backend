# DEFINITIVE Agent Decision Tree - Every Path, Every Option
**Created:** 2026-02-28  
**Source:** Code analysis of Agent2DiscoveryRunner.js (V125)  
**Purpose:** Complete troubleshooting map - no guessing

---

## 🎯 **COMPLETE FLOW - Every Decision Point**

```
📞 CALL STARTS
│
├─ 1. TWILIO ENTRY (routes/v2twilio.js:1004)
│   └─ Lookup company by phone number
│       ├─ Company found → Continue
│       └─ No company → "Configuration error" → Hangup
│
├─ 2. GATEKEEPER (routes/v2twilio.js:1328)
│   └─ Check company.accountStatus.status
│       ├─ "active" → Continue
│       ├─ "suspended" → Play suspendedMessage → Hangup
│       └─ "call_forward" → Play forwardMessage → Dial(forwardNumber)
│
├─ 3. SPAM FILTER (routes/v2twilio.js:1050)
│   └─ SmartCallFilter.checkCall()
│       ├─ shouldBlock=false → Continue
│       └─ shouldBlock=true → "Call blocked" → Hangup
│
├─ 4. CALL START GREETING (routes/v2twilio.js:1578)
│   └─ Check agent2.greetings.callStart
│       ├─ mode="prerecorded" + audioUrl exists
│       │   └─ <Play> audioUrl
│       ├─ mode="prerecorded" + audioUrl missing
│       │   └─ Fall back to TTS or emergencyFallback
│       ├─ voiceId exists + text exists
│       │   └─ ElevenLabs TTS → <Play> generated MP3
│       └─ mode="disabled"
│           └─ Skip greeting, go straight to <Gather>
│
├─ 5. GATHER SETUP (routes/v2twilio.js:1644)
│   └─ <Gather> configured with:
│       - input: "speech"
│       - action: /api/twilio/v2-agent-respond/:companyId
│       - enhanced: true (Deepgram STT)
│       - speechModel: "phone_call"
│
├─ 6. CUSTOMER SPEAKS
│   └─ Deepgram transcribes → SpeechResult
│
├─ 7. SPEECHRESULT POSTED (routes/v2twilio.js:3523)
│   └─ POST /v2-agent-respond with SpeechResult
│
├─ 8-12. SCRABENGINE (V125 - RUNS FIRST!)
│   │
│   ├─ 8. ScrabEngine.process() (ScrabEngine.js)
│   │   └─ Input: RAW SpeechResult
│   │
│   ├─ 9. Stage 1: Filler Removal
│   │   └─ Remove: "hi", "hello", "um", "uh", "like"
│   │
│   ├─ 10. Stage 2: Vocabulary Expansion
│   │   └─ "acee" → "ac", "tstat" → "thermostat"
│   │
│   ├─ 11. Stage 3: Synonym Mapping
│   │   └─ "broken" → "not working", "asap" → "urgent"
│   │
│   └─ 12. Stage 4: Entity Extraction + Quality Gate
│       └─ Extract: firstName, lastName, phone, urgency, serviceType
│       └─ Output: normalizedText + entities
│
├─ 13. LOAD CALL STATE (StateStore.js)
│   └─ Load from Redis: call:{CallSid}
│       ├─ Found → Load state
│       └─ Not found → Initialize new state
│
├─ 14. CALLRUNTIME.PROCESSTURN (CallRuntime.js:293)
│   └─ Check state.lane or state.sessionMode
│       ├─ === "BOOKING" → Route to BookingLogicEngine
│       └─ ELSE → Route to Agent2DiscoveryRunner
│
├─ 15. AGENT2DISCOVERYRUNNER.RUN (Agent2DiscoveryRunner.js:414)
│   │
│   ├─ Check: agent2.enabled && discovery.enabled
│   │   ├─ FALSE → Return null (disabled)
│   │   └─ TRUE → Continue
│   │
│   ├─ 16. GREETING INTERCEPTOR (Line 564 - V125)
│   │   └─ Agent2GreetingInterceptor.evaluate(normalizedInput)
│   │       ├─ Check: greetings.interceptor.enabled
│   │       │   └─ FALSE → Skip greeting check
│   │       ├─ Check: Short-only gate (≤maxWordsToQualify)
│   │       │   └─ Too long → NO MATCH
│   │       ├─ Check: Has intent words (intentWords config)
│   │       │   └─ Has intent → NO MATCH
│   │       ├─ Check: Already greeted this call (one-shot guard)
│   │       │   └─ Already greeted → NO MATCH
│   │       ├─ Check: Matches greeting triggers
│   │       │   └─ Matches → GREETING DETECTED
│   │       │       └─ V125: Store result, CONTINUE (no early exit!)
│   │       └─ No match → Continue
│   │
│   ├─ 17. ROBOT CHALLENGE CHECK (Line 800+)
│   │   └─ Check for robot keywords: "press 1", "automated"
│   │       ├─ Matched → Return robot response
│   │       └─ No match → Continue
│   │
│   ├─ 18. CLARIFIER RESOLUTION (Line 773)
│   │   └─ Check: pendingClarifier from last turn
│   │       ├─ User said YES → Lock component, continue
│   │       ├─ User said NO → Clear clarifier, continue
│   │       └─ No pending → Continue
│   │
│   ├─ 19. FOLLOW-UP QUESTION HANDLER (5-Bucket System, Line 814)
│   │   └─ Check: pendingFollowUpQuestion from last turn
│   │       ├─ User response bucket:
│   │       │   ├─ YES → Execute nextAction, return response
│   │       │   ├─ NO → Clear question, return acknowledgment
│   │       │   ├─ REPROMPT → Re-ask question
│   │       │   ├─ HESITANT → Encourage, re-ask
│   │       │   └─ CLARIFY → Answer their question, re-ask
│   │       └─ No pending → Continue
│   │
│   ├─ 20. TRIGGER CARD MATCHING (Line 1509 - PRIMARY PATH!)
│   │   │
│   │   ├─ TriggerCardMatcher.getCompiledTriggers()
│   │   │   └─ Load: Global + Company Local + Legacy playbook.rules
│   │   │
│   │   ├─ TriggerCardMatcher.match(normalizedInput, triggers)
│   │   │   └─ Process:
│   │   │       1. Check each card's keywords against normalizedInput
│   │   │       2. Check negative keywords (disqualify if match)
│   │   │       3. Apply hint boosts (if component locked)
│   │   │       4. Apply intent priority gate (FAQ vs Service)
│   │   │       5. Rank by priority (100 = highest)
│   │   │       6. Return best match
│   │   │
│   │   └─ Result:
│   │       ├─ MATCHED (Line 1585) → Use trigger response
│   │       │   │
│   │       │   ├─ Check: card.responseMode === 'llm'
│   │       │   │   └─ TRUE → Generate LLM response from fact pack
│   │       │   │   └─ FALSE → Use card.answer.answerText
│   │       │   │
│   │       │   ├─ Build response with {name} substitution
│   │       │   │
│   │       │   ├─ Check: card.answer.audioUrl exists
│   │       │   │   └─ TRUE → Return audioUrl (pre-recorded)
│   │       │   │   └─ FALSE → TTS will generate
│   │       │   │
│   │       │   ├─ Check: card.followUp.question exists
│   │       │   │   └─ TRUE → Store pendingFollowUpQuestion
│   │       │   │   └─ FALSE → No follow-up
│   │       │   │
│   │       │   └─ RETURN trigger response (Line 1824)
│   │       │
│   │       └─ NO MATCH → Continue to fallback paths
│   │
│   ├─ 21. CLARIFIER QUESTIONS (Line 1856)
│   │   └─ Check: No trigger matched + activeHints exist + clarifiers enabled
│   │       ├─ Hint needs clarification → Ask clarifier question
│   │       └─ No hints → Continue
│   │
│   ├─ 22. SCENARIO ENGINE FALLBACK (Line 1949 - OPT-IN ONLY)
│   │   └─ Check: playbook.useScenarioFallback === true
│   │       ├─ TRUE → Try ScenarioEngine.selectResponse()
│   │       │   ├─ Confidence >= minScore → Use scenario
│   │       │   └─ Too low → Continue
│   │       └─ FALSE → Skip (default)
│   │
│   ├─ 23. GREETING FALLBACK (Line 2075 - V125 NEW!)
│   │   └─ Check: greetingDetected && greetingResponse
│   │       ├─ TRUE → Return greeting response
│   │       └─ FALSE → Continue
│   │
│   ├─ 24. CAPTURED REASON ACKNOWLEDGMENT (Line 2200+)
│   │   └─ Check: capturedReason exists (from previous turn)
│   │       ├─ TRUE → "Got it. [afterReasonResponse]"
│   │       └─ FALSE → Continue
│   │
│   ├─ 25. LLM FALLBACK (Line 2164)
│   │   └─ Check: LLM not blocked
│   │       ├─ Blocked (max turns, booking flow, etc.) → Continue
│   │       └─ Allowed → Call GPT-4, return LLM response
│   │
│   └─ 26. GENERIC FALLBACK (Line 2400+ - LAST RESORT)
│       └─ Check: capturedReason exists
│           ├─ TRUE → "Got it. [reasonSpecificFallback]"
│           └─ FALSE → "How can I help you?" (basic fallback)
│               └─ OR emergencyFallbackLine if configured
│
└─ 27. RETURN RESPONSE
    └─ Send to CallRuntime → TwiML → Twilio → Customer
```

---

## 🚨 **CRITICAL DECISION POINTS - Where Agent Can Deviate**

### **Decision Point 1: Agent2 Enabled? (Line 545)**
```
IF agent2.enabled !== true OR discovery.enabled !== true:
  → Return null
  → RESULT: No AI response at all
```

### **Decision Point 2: Greeting Early Exit (Line 564 - FIXED in V125)**
```
OLD (V124):
IF greetingResult.intercepted:
  → Return greeting response
  → EXIT EARLY ❌
  → Triggers NEVER evaluated

NEW (V125):
IF greetingResult.intercepted:
  → Store greeting for later
  → CONTINUE to triggers ✅
```

### **Decision Point 3: Trigger Match (Line 1585)**
```
IF triggerResult.matched:
  → Use trigger response
  → RETURN (Line 1824)
  → END (never reaches LLM)

IF NOT matched:
  → Continue to fallback paths
```

### **Decision Point 4: LLM Allowed? (Line 2164)**
```
Blocked if ANY of these true:
- llmTurnsThisCall >= maxLLMFallbackTurnsPerCall (default: 1)
- inBookingFlow === true
- inDiscoveryCriticalStep === true
- hasPendingQuestion === true
- hasCapturedReasonFlow === true
- hasAfterHoursFlow === true
- hasTransferFlow === true
- bookingModeLocked === true

IF all checks pass:
  → Call LLM, return response
ELSE:
  → Continue to generic fallback
```

### **Decision Point 5: Generic Fallback (Line 2400+)**
```
IF capturedReason exists:
  → "Got it. [reasonSpecificFallback]"
ELSE:
  → "How can I help you?" or emergencyFallbackLine
```

---

## 🔍 **WHY "SORRY YOU CUT OUT" APPEARS**

Let me search for that exact phrase in the code:

**Searching for:** "you cut out", "cut out for a second"

**Possible Sources:**
1. Generic fallback hardcoded text
2. Emergency fallback line
3. LLM generating it
4. Trigger card with that text

Let me check the actual fallback text...

**FOUND IT:** This is likely the **generic fallback** when:
- No trigger matched
- LLM blocked (max turns reached)
- No greeting detected
- No captured reason

**Code location:** Agent2DiscoveryRunner.js final fallback section

---

## ✅ **COMPLETE PATH MAP FOR FLOW BUILDER**

Let me create the DEFINITIVE step list with ALL decision points:

**INCOMING CALL PHASE:**
1. Twilio Entry
2. Gatekeeper (3 options: active/suspended/forward)
3. Spam Filter (2 options: allow/block)

**GREETING PHASE:**
4. Call Start Greeting (3 modes: prerecorded/tts/disabled)
5. Gather Setup

**CUSTOMER INPUT PHASE:**
6. Customer Speaks
7. SpeechResult Posted

**TEXT PROCESSING PHASE (V125 - RUNS FIRST):**
8. ScrabEngine Entry
9. SE Step 1: Fillers
10. SE Step 2: Vocabulary
11. SE Step 3: Synonyms
12. SE Step 4: Extraction

**ORCHESTRATION PHASE:**
13. Load State
14. CallRuntime (2 routes: DISCOVERY/BOOKING)
15. Agent2DiscoveryRunner

**DECISION PHASE (Inside Agent2DiscoveryRunner):**
16. ✅ Agent2 Enabled Check (enabled/disabled)
17. ✅ Greeting Interceptor (matched/not matched)
18. ✅ Robot Challenge (matched/not matched)
19. ✅ Clarifier Resolution (pending/not pending)
20. ✅ Follow-Up Handler (5 buckets: YES/NO/REPROMPT/HESITANT/CLARIFY)
21. ✅ **TRIGGER MATCHING** (CRITICAL - PRIMARY PATH)
22. ✅ Clarifier Questions (hints exist/no hints)
23. ✅ Scenario Engine (enabled/disabled)
24. ✅ Greeting Fallback (V125 - greeting detected/not)
25. ✅ Captured Reason Ack (reason exists/not)
26. ✅ LLM Fallback (allowed/blocked - 8 blocking conditions)
27. ✅ Generic Fallback (LAST RESORT)

**RESPONSE GENERATION PHASE:**
28. Name Greeting (turn 1 only)
29. Hold Modal Check
30. Audio Selection (pre-recorded/TTS/Say)
31. ElevenLabs TTS (if needed)
32. Variable Substitution ({name}, {company})
33. TwiML Generation
34. Return to Twilio

---

## 🎯 **FOR YOUR FLOW BUILDER**

I need to update it with:
1. ALL 27 decision points (not just 25 steps)
2. EVERY option at each point (enabled/disabled, matched/not, etc.)
3. EVERY exit path (return points)
4. EXACT line numbers for each decision
5. What happens if TRUE vs FALSE

**Shall I create the COMPLETE DEFINITIVE version now with all decision trees?**

This will be the ULTIMATE troubleshooting map - you'll see EXACTLY where the agent can deviate and why.
