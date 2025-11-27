# 📞 COMPLETE CALL FLOW MAP - ClientsVia V2 System

## 🎯 THE PROBLEM
Multiple systems, unclear routing, code being added without understanding the flow.

## 🗺️ THE ACTUAL CALL FLOW (As Of Now)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TWILIO RECEIVES CALL                                 │
│                    Caller dials: +12392322030                                │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: POST /api/twilio/voice                                              │
│  File: routes/v2twilio.js (line 583)                                         │
│                                                                               │
│  Actions:                                                                     │
│  ✓ Log everything (CallSid, From, To)                                        │
│  ✓ Normalize phone numbers                                                   │
│  ✓ Lookup company by called number (+12392322030)                            │
│  ✓ Run spam filter (SmartCallFilter.checkCall)                               │
│  ✓ Detect call source (production/test)                                      │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 2: Initialize V2 AI Agent                                              │
│  File: services/v2AIAgentRuntime.js (line 47)                                │
│  Function: initializeCall()                                                  │
│                                                                               │
│  Actions:                                                                     │
│  ✓ Load company document from MongoDB                                        │
│  ✓ Auto-enable aiAgentSettings if missing (line 66-79)                       │
│  ✓ Generate greeting (generateV2Greeting)                                    │
│     - Checks: connectionMessages.voice.greeting                               │
│     - Returns: { mode, text, audioUrl }                                      │
│  ✓ Return initialization result with callState                               │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 3: Generate Greeting TTS (Back in /voice route)                        │
│  File: routes/v2twilio.js (line 966-1006)                                    │
│                                                                               │
│  Actions:                                                                     │
│  ✓ Check if ElevenLabs voice configured                                      │
│  ✓ If YES: synthesizeSpeech() → save MP3 → get URL                           │
│  ✓ If NO: Use Twilio <Say>                                                   │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 4: Send TwiML with <Gather>                                            │
│  File: routes/v2twilio.js (line 933-956)                                     │
│                                                                               │
│  TwiML Structure:                                                             │
│  <Response>                                                                   │
│    <Gather input="speech"                                                     │
│            action="/api/twilio/v2-agent-respond/68e3f77..."                  │
│            partialResultCallback="/api/twilio/v2-agent-partial/68e3f77...">  │
│      <Play>http://...elevenlabs-audio.mp3</Play>                             │
│    </Gather>                                                                  │
│    <Say>I didn't hear anything. Please try calling back later.</Say>         │
│    <Hangup/>                                                                  │
│  </Response>                                                                  │
│                                                                               │
│  Sent to: Twilio                                                              │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  TWILIO PLAYS GREETING AND LISTENS                                           │
│                                                                               │
│  🔊 Caller hears: ElevenLabs voice greeting                                  │
│  🎤 Caller speaks: "Hi, I need AC service please"                            │
│                                                                               │
│  During speech recognition:                                                   │
│  → Twilio sends partial results to: /v2-agent-partial/:companyId             │
│     (Every ~200ms, just for monitoring - returns empty <Response>)           │
│                                                                               │
│  After speech complete:                                                       │
│  → Twilio POSTs to: /v2-agent-respond/:companyID                             │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 5: POST /api/twilio/v2-agent-respond/:companyID                        │
│  File: routes/v2twilio.js (line 1645)                                        │
│                                                                               │
│  Receives:                                                                    │
│  - SpeechResult: "Hi, I need AC service please"                              │
│  - Confidence: 0.95                                                           │
│  - CallSid: CA077944...                                                       │
│                                                                               │
│  Actions:                                                                     │
│  ✓ Load or initialize callState from session                                 │
│  ✓ Call: v2AIAgentRuntime.processUserInput()                                 │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 6: Process User Input (THE BRAIN)                                      │
│  File: services/v2AIAgentRuntime.js (line 350)                               │
│  Function: processUserInput()                                                │
│                                                                               │
│  Actions:                                                                     │
│  ✓ Load company document                                                     │
│  ✓ Call CallFlowExecutor.execute()                                           │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 7: DYNAMIC CALL FLOW EXECUTION                                         │
│  File: services/CallFlowExecutor.js (line 39)                                │
│                                                                               │
│  Executes steps in order from callFlowConfig (or default):                   │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │ SUB-STEP 7A: Frontline-Intel (THE BODY)                          │       │
│  │ File: services/CallFlowExecutor.js (line 166)                    │       │
│  │                                                                   │       │
│  │ ✓ Extract caller name, phone, email from text                    │       │
│  │ ✓ Run triage using FrontlineIntel.matchTriageRules()             │       │
│  │   - Loads compiled triage rules from TriageCardService           │       │
│  │   - Matches keywords against user input                          │       │
│  │   - Returns action: DIRECT_TO_3TIER | ESCALATE_TO_HUMAN |        │       │
│  │                     TAKE_MESSAGE | END_CALL_POLITE                │       │
│  │                                                                   │       │
│  │ ⚠️ FALLBACK RULE (if no match):                                  │       │
│  │   action: DIRECT_TO_3TIER (changed from ESCALATE_TO_HUMAN)       │       │
│  │   File: services/TriageCardService.js (line 402-414)             │       │
│  │                                                                   │       │
│  │ Switch based on action:                                           │       │
│  │ - ESCALATE_TO_HUMAN → return { finalAction: 'transfer' }         │       │
│  │ - TAKE_MESSAGE → return { finalAction: 'continue' }              │       │
│  │ - DIRECT_TO_3TIER → continue to next step                        │       │
│  └──────────────────────────────────────────────────────────────────┘       │
│                                 │                                             │
│                                 ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │ SUB-STEP 7B: Generate Base Response                              │       │
│  │ File: services/CallFlowExecutor.js (line 247)                    │       │
│  │                                                                   │       │
│  │ ✓ Calls v2AIAgentRuntime.generateV2Response()                    │       │
│  │   - Uses Intelligent Router (3-Tier System)                      │       │
│  │   - Tier 1: Rule-based scenario matching                         │       │
│  │   - Tier 2: Semantic vector matching                             │       │
│  │   - Tier 3: LLM fallback (if enabled)                            │       │
│  │ ✓ Returns scenario match or generates response                   │       │
│  └──────────────────────────────────────────────────────────────────┘       │
│                                 │                                             │
│                                 ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │ SUB-STEP 7C: Apply CheatSheet Policy (Control Plane V2)          │       │
│  │ File: services/CallFlowExecutor.js (line 277)                    │       │
│  │                                                                   │       │
│  │ ✓ Load compiled policy from CheatSheetRuntimeService             │       │
│  │ ✓ Apply CheatSheetEngine rules in precedence order:              │       │
│  │   1. Edge Cases (highest priority)                               │       │
│  │   2. Transfer Rules                                               │       │
│  │   3. Behavior Rules                                               │       │
│  │   4. Guardrails                                                   │       │
│  │                                                                   │       │
│  │ ✓ Can modify response or override action                         │       │
│  │ ✓ Can force transfer if transfer rule matches                    │       │
│  └──────────────────────────────────────────────────────────────────┘       │
│                                                                               │
│  Returns:                                                                     │
│  {                                                                            │
│    finalResponse: "I'd be happy to help...",                                 │
│    finalAction: 'continue' | 'transfer' | 'hangup',                          │
│    shortCircuit: false,                                                       │
│    cheatSheetMeta: { appliedBlocks, timeMs }                                 │
│  }                                                                            │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 8: Map Action to Legacy Format (Back in /v2-agent-respond)             │
│  File: routes/v2twilio.js (line 1714-1721)                                   │
│                                                                               │
│  ✓ If action === 'transfer' → set shouldTransfer = true                      │
│  ✓ If action === 'hangup' → set shouldHangup = true                          │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 9: Generate Response TwiML                                             │
│  File: routes/v2twilio.js (line 1723-1968)                                   │
│                                                                               │
│  THREE POSSIBLE PATHS:                                                        │
│                                                                               │
│  PATH A: shouldHangup = true                                                  │
│  ─────────────────────────────                                               │
│  ✓ Say final message with Twilio <Say>                                       │
│  ✓ <Hangup/>                                                                 │
│  ✓ Send TwiML to Twilio → Call ends                                          │
│                                                                               │
│  PATH B: shouldTransfer = true                                                │
│  ──────────────────────────────                                              │
│  ✓ Generate transfer message with ElevenLabs (if configured)                 │
│  ✓ <Play>elevenlabs-audio.mp3</Play>                                         │
│  ✓ Call handleTransfer():                                                    │
│    - If transfer enabled + number configured → <Dial>number</Dial>           │
│    - If transfer disabled → Continue with <Gather> (stay in conversation)    │
│  ✓ Send TwiML to Twilio                                                      │
│                                                                               │
│  PATH C: Normal conversation (default)                                        │
│  ───────────────────────────────────────                                     │
│  ✓ Generate response audio with ElevenLabs (if configured)                   │
│  ✓ Create <Gather> for next turn:                                            │
│    <Response>                                                                 │
│      <Gather input="speech"                                                   │
│              action="/api/twilio/v2-agent-respond/:companyID"                │
│              partialResultCallback="/api/twilio/v2-agent-partial/:companyID">│
│        <Play>http://...elevenlabs-response.mp3</Play>                        │
│      </Gather>                                                                │
│      <Say>I didn't hear anything...</Say>                                     │
│      <Hangup/>                                                                │
│    </Response>                                                                │
│  ✓ Send TwiML to Twilio                                                      │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 10: LOOP BACK TO STEP 5                                                │
│                                                                               │
│  🔊 Twilio plays AI response                                                 │
│  🎤 Caller speaks again                                                       │
│  → POST /v2-agent-respond/:companyID (repeat from Step 5)                    │
│                                                                               │
│  This continues until:                                                        │
│  - Call ends (hangup action)                                                  │
│  - Call transferred (transfer action + number configured)                    │
│  - Caller hangs up                                                            │
│  - Timeout (silence)                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 🔑 KEY SYSTEMS IN THE FLOW

### 1. **Spam Filter** (Step 1)
- **File**: `services/SmartCallFilter.js`
- **Purpose**: Block spam/robocalls before processing
- **Checks**: Global blacklist, company blacklist, frequency, robocall patterns

### 2. **V2 AI Agent Runtime** (Step 2 & 6)
- **File**: `services/v2AIAgentRuntime.js`
- **Functions**:
  - `initializeCall()` - Generate greeting
  - `processUserInput()` - Process each turn
- **Returns**: Greeting config and call state

### 3. **Call Flow Executor** (Step 7)
- **File**: `services/CallFlowExecutor.js`
- **Purpose**: Orchestrate multi-step processing
- **Default Flow**:
  1. Frontline-Intel (triage)
  2. Generate Base Response (3-Tier)
  3. Apply CheatSheet Policy (Control Plane V2)

### 4. **Frontline-Intel / THE BODY** (Step 7A)
- **Files**: 
  - `services/FrontlineIntel.js` - Processing logic
  - `services/TriageCardService.js` - Rule compilation
- **Purpose**: Extract info, triage, decide action
- **Actions**: DIRECT_TO_3TIER, ESCALATE_TO_HUMAN, TAKE_MESSAGE, END_CALL_POLITE

### 5. **Intelligent Router / 3-Tier System** (Step 7B)
- **File**: `services/IntelligentRouter.js`
- **Tiers**:
  - Tier 1: Rule-based (keyword matching) - FAST, FREE
  - Tier 2: Semantic (vector similarity) - FAST, FREE
  - Tier 3: LLM (OpenAI) - SLOW, COSTS $$$
- **Purpose**: Match caller intent to scenario

### 6. **CheatSheet Engine / Control Plane V2** (Step 7C)
- **Files**:
  - `services/CheatSheetEngine.js` - Rule application
  - `services/cheatsheet/CheatSheetRuntimeService.js` - Policy loading
- **Purpose**: Apply business rules, modify responses, enforce guardrails
- **Precedence**:
  1. Edge Cases (highest)
  2. Transfer Rules
  3. Behavior Rules
  4. Guardrails (lowest)

### 7. **ElevenLabs TTS** (Steps 3 & 9)
- **File**: `services/v2elevenLabsService.js`
- **Function**: `synthesizeSpeech(text, voiceId, companyId)`
- **Purpose**: Convert text → MP3 audio
- **Fallback**: Twilio `<Say>` if ElevenLabs fails

## 🚨 CURRENT ISSUES & RECENT FIXES

### ✅ FIXED (Today):
1. **Missing `/v2-agent-partial/:companyId` route** → Added empty response handler
2. **Over-aggressive transfer** → Changed fallback from ESCALATE_TO_HUMAN to DIRECT_TO_3TIER
3. **Transfer using Twilio voice** → Now uses ElevenLabs for transfer messages

### ⚠️ POTENTIAL ISSUES:
1. **Royal HVAC Missing Greeting Configuration**
   - If `connectionMessages.voice.greeting` is not set → fallback message used
   - Configure in: AI Agent Settings → Messages & Greetings

2. **No Triage Rules Configured**
   - Falls back to system rule (now DIRECT_TO_3TIER)
   - Should configure triage cards for better routing

3. **Multiple Call Flow Paths**
   - `/voice` (phone lookup)
   - `/voice/:companyID` (direct company ID)
   - Can cause confusion if both configured

## 📋 DECISION POINTS

### Where Does the Call Go?

```
User says: "I need AC service"
                 │
                 ▼
          Frontline-Intel
          (Triage Rules)
                 │
        ┌────────┼────────┐
        │                 │
    MATCH             NO MATCH
        │                 │
        ▼                 ▼
   Rule Action      Fallback Rule
        │           (DIRECT_TO_3TIER)
        │                 │
        └────────┬────────┘
                 │
        ┌────────┴────────┬──────────────┬─────────────┐
        │                 │              │             │
   DIRECT_TO_3TIER   ESCALATE      TAKE_MESSAGE   END_CALL
        │             TO_HUMAN         │             │
        ▼                 │             │             │
    3-Tier Router         │             │             │
        │                 │             │             │
        ▼                 │             │             │
  CheatSheet Engine       │             │             │
        │                 │             │             │
        └─────────────────┴─────────────┴─────────────┘
                         │
                         ▼
                  Generate TwiML
                         │
             ┌───────────┼───────────┐
             │           │           │
         Continue    Transfer    Hangup
```

## 🎯 WHAT YOU NEED TO KNOW

### To Configure a Company:
1. **Greeting**: AI Agent Settings → Messages & Greetings
2. **Voice**: AI Agent Settings → Voice Settings → Select ElevenLabs voice
3. **Triage**: Control Plane V2 → Triage Cards (or use fallback)
4. **Scenarios**: Control Plane V2 → Scenario Hub
5. **CheatSheet**: Control Plane V2 → Frontline-Intel, Transfer Rules, etc.

### To Debug a Call:
1. Check logs for: `[🎯 ENTRY] Twilio /voice hit`
2. Follow CallSid through the logs
3. Look for: `[CALL FLOW EXECUTOR]` logs to see which steps ran
4. Check: `[THE BRAIN]` logs to see triage decision
5. Check: `🤖 AI Response:` to see final action

### To Modify Behavior:
1. **Change greeting** → Configure in AI Agent Settings
2. **Change triage logic** → Add/edit Triage Cards
3. **Change responses** → Add/edit Scenarios
4. **Add business rules** → Control Plane V2 → CheatSheet sections

## 🚫 STOP CODING UNTIL:
- [ ] You understand which step you're modifying
- [ ] You know what comes before and after
- [ ] You know which files are involved
- [ ] You test the ENTIRE flow after changes

## 📞 FOR ROYAL HVAC SPECIFICALLY:
- Company ID: `68e3f77a9d623b8058c700c4`
- Phone: `+12392322030`
- Current Issue: Needs greeting configured in Messages & Greetings
- Voice: ElevenLabs voice ID configured ✅
- Triage: Using fallback rule (DIRECT_TO_3TIER) ✅

