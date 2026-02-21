# Call Review - Provenance Event Flow

## How Transcript Attribution Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CALL HAPPENS                                 │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Backend processes caller input and generates agent response        │
│                                                                      │
│  Example: Agent2DiscoveryRunner finds matching trigger card         │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  TWO CRITICAL EVENTS MUST BE EMITTED:                               │
│                                                                      │
│  1️⃣ SPEECH_SOURCE_SELECTED (or SPEAK_PROVENANCE)                    │
│     {                                                                │
│       sourceId: 'agent2.discovery.triggerCard',                     │
│       uiPath: 'aiAgentSettings.agent2.discovery.playbook.rules[]',  │
│       uiTab: 'Agent 2.0 > Configuration',                           │
│       spokenTextPreview: 'What service can I help you with?'        │
│     }                                                                │
│                                                                      │
│  2️⃣ TWIML_SENT                                                       │
│     {                                                                │
│       responsePreview: 'What service can I help you with?',         │
│       hasPlay: false,                                               │
│       hasSay: true                                                  │
│     }                                                                │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Events stored in BlackBox database                                 │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  User opens Call Review tab                                         │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Frontend (Agent2Manager.js) calls buildTranscript()                │
│                                                                      │
│  1. Collects GATHER_FINAL events (caller inputs)                    │
│  2. Collects TWIML_SENT events (agent responses)                    │
│  3. Looks for SPEECH_SOURCE_SELECTED for each response              │
│  4. Matches sources to responses by turn number                     │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  RESULT - Three Possible Outcomes:                                  │
│                                                                      │
│  ✅ BOTH events found:                                              │
│     Shows: "📍 Trigger Card Answer"                                │
│            "aiAgentSettings.agent2.discovery.playbook.rules[]"      │
│                                                                      │
│  ⚠️ Only TWIML_SENT found (no SPEECH_SOURCE_SELECTED):             │
│     Shows: "🚨 MISSING PROVENANCE - Turn 3"                        │
│            "No SPEAK_PROVENANCE or SPEECH_SOURCE_SELECTED event"    │
│                                                                      │
│  ❌ Neither event found:                                            │
│     Response doesn't appear in transcript at all                    │
│     (Shows in diagnostic panel as "missing turn")                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## The Problem Visualized

### ✅ WORKING PATH (Agent2 Discovery)

```
┌──────────────────────┐
│  Caller says:        │
│  "I need a plumber"  │
└──────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│  Agent2DiscoveryRunner.js               │
│                                         │
│  1. Finds matching trigger card         │
│  2. Calls emit('SPEECH_SOURCE_SELECTED')│  ✅ Event emitted
│  3. Calls emit('A2_RESPONSE_READY')     │
│  4. Returns response text               │
└─────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│  FrontDeskCoreRuntime.js                │
│  Calls emit('CORE_RUNTIME_OWNER_RESULT')│
└─────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│  routes/v2twilio.js                     │
│                                         │
│  1. Builds TwiML                        │
│  2. await CallLogger.logEvent(          │  ✅ Event emitted
│      type: 'TWIML_SENT',                │
│      responsePreview: '...'             │
│    )                                    │
│  3. Returns TwiML to Twilio             │
└─────────────────────────────────────────┘
          │
          ▼
    ✅ RESULT: Full attribution in Call Review
    Shows source, UI path, tab name
```

### ⚠️ BROKEN PATH (Direct twiml.say() without provenance)

```
┌──────────────────────┐
│  Transfer triggered  │
└──────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│  routes/v2twilio.js (line 736)          │
│                                         │
│  twiml.say(transferMessage);            │  ❌ No SPEECH_SOURCE_SELECTED
│                                         │
│  // Missing event emission!             │
│  // Should have:                        │
│  // await CallLogger.logEvent({         │
│  //   type: 'SPEECH_SOURCE_SELECTED',   │
│  //   data: { sourceId, uiPath, ... }   │
│  // })                                  │
└─────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│  TwiML sent to Twilio                   │
│  (TWIML_SENT event may still be logged) │  ⚠️ Event emitted but no source
└─────────────────────────────────────────┘
          │
          ▼
    ⚠️ RESULT: "Source unknown" in Call Review
    Shows response text but no attribution
```

---

## Event Timeline Example

### Complete Call with All Events (Good)

```
Turn 0 (Greeting):
  ✅ GREETING_SENT           - "Hi, thank you for calling!"
  ✅ SPEECH_SOURCE_SELECTED  - sourceId: agent2.greetings.callStart
  ✅ TWIML_SENT              - responsePreview: "Hi, thank..."

Turn 1 (First exchange):
  ✅ GATHER_FINAL            - "I need a plumber"
  ✅ A2_TRIGGER_EVAL         - Matched: plumbing_services
  ✅ SPEECH_SOURCE_SELECTED  - sourceId: agent2.discovery.triggerCard
  ✅ A2_RESPONSE_READY       - responsePreview: "What service can I..."
  ✅ TWIML_SENT              - responsePreview: "What service can I..."

Turn 2 (Follow-up):
  ✅ GATHER_FINAL            - "Fix my toilet"
  ✅ A2_LLM_FALLBACK_DECISION - LLM assist enabled
  ✅ SPEECH_SOURCE_SELECTED  - sourceId: agent2.llmFallback.infoGather
  ✅ A2_RESPONSE_READY       - responsePreview: "Got it, when works..."
  ✅ TWIML_SENT              - responsePreview: "Got it, when works..."

RESULT: ✅ All turns show full attribution in Call Review
```

### Incomplete Call with Missing Events (Bad)

```
Turn 0 (Greeting):
  ✅ GREETING_SENT           - "Hi, thank you for calling!"
  ✅ SPEECH_SOURCE_SELECTED  - sourceId: agent2.greetings.callStart
  ✅ TWIML_SENT              - responsePreview: "Hi, thank..."

Turn 1 (First exchange):
  ✅ GATHER_FINAL            - "I need a plumber"
  ✅ A2_TRIGGER_EVAL         - Matched: plumbing_services
  ❌ SPEECH_SOURCE_SELECTED  - MISSING!
  ✅ A2_RESPONSE_READY       - responsePreview: "What service can I..."
  ✅ TWIML_SENT              - responsePreview: "What service can I..."

Turn 2 (Transfer):
  ⚠️ Transfer initiated
  ❌ SPEECH_SOURCE_SELECTED  - MISSING!
  ⚠️ TWIML_SENT              - responsePreview: "Connecting you..."
  
RESULT: ⚠️ Turn 1 shows "Source unknown" - Turn 2 may not appear in transcript
```

---

## Data Flow Diagram

```
┌──────────────┐
│   Backend    │  Emits events during call
│  (Runtime)   │  ────────────────────────┐
└──────────────┘                          │
                                          ▼
                                 ┌────────────────┐
                                 │  BlackBox DB   │
                                 │  (MongoDB)     │
                                 └────────────────┘
                                          │
                              Fetched when user opens Call Review
                                          │
                                          ▼
┌──────────────┐              ┌────────────────────┐
│   Frontend   │  Calls API   │  Backend API       │
│ Agent2Manager│──────────────▶│ /agent2/calls/     │
└──────────────┘              │ {companyId}/{sid}  │
       │                      │ /events            │
       │                      └────────────────────┘
       │                               │
       │                               │ Returns events array
       │                               ▼
       │                      ┌────────────────────┐
       │                      │ [                   │
       │                      │   {type: 'CALL_...'│
       │                      │   {type: 'SPEECH..'│
       │                      │   {type: 'TWIML..' │
       │                      │ ]                   │
       │                      └────────────────────┘
       │                               │
       ▼                               ▼
┌──────────────────────────────────────────┐
│  buildTranscript(events)                 │
│                                          │
│  Processes events to create:             │
│  [                                       │
│    { role: 'agent',                      │
│      text: '...',                        │
│      speechSource: {                     │ ← Populated from SPEECH_SOURCE_SELECTED
│        sourceId: '...',                  │
│        uiPath: '...',                    │
│        uiTab: '...'                      │
│      }                                   │
│    },                                    │
│    { role: 'caller', text: '...' }      │
│  ]                                       │
└──────────────────────────────────────────┘
                  │
                  ▼
         ┌────────────────┐
         │  Render in UI  │
         │  with source   │
         │  attribution   │
         └────────────────┘
```

---

## SpeechGuard Registry Flow

```
┌─────────────────────────────────────────────┐
│  SpeechGuard.SPEECH_REGISTRY                │
│                                             │
│  'agent2.discovery.triggerCard': {          │
│    uiPath: 'aiAgentSettings.agent2...',     │
│    uiTab: 'Agent 2.0 > Configuration',      │
│    configPath: '...',                       │
│    description: 'Trigger card answer'       │
│  }                                          │
└─────────────────────────────────────────────┘
                  │
                  │ Used by backend to validate
                  │ and build provenance events
                  ▼
┌─────────────────────────────────────────────┐
│  Backend calls:                             │
│  emit('SPEECH_SOURCE_SELECTED', {           │
│    sourceId: 'agent2.discovery.triggerCard',│ ← Must match registry
│    uiPath: SpeechRegistry[sourceId].uiPath, │
│    ...                                      │
│  })                                         │
└─────────────────────────────────────────────┘
                  │
                  ▼
         Logged to BlackBox
                  │
                  ▼
     Used by Call Review to show attribution
```

---

## The Fix at a Glance

**Before (BROKEN):**
```javascript
twiml.say('I am transferring you.');
```

**After (FIXED):**
```javascript
await CallLogger.logEvent({
  callId: callSid,
  companyId: company._id,
  type: 'SPEECH_SOURCE_SELECTED',
  turn: turnNumber,
  data: {
    sourceId: 'transfer.message',
    uiPath: 'aiAgentSettings.transferSettings.transferMessage',
    uiTab: 'Transfer Settings',
    configPath: 'transferSettings.transferMessage',
    spokenTextPreview: 'I am transferring you.'
  }
}).catch(() => {});

twiml.say('I am transferring you.');
```

---

## Summary

1. **Every `twiml.say()` needs a `SPEECH_SOURCE_SELECTED` event**
2. **sourceId must be registered in SpeechGuard.SPEECH_REGISTRY**
3. **Event must be emitted BEFORE the twiml.say() call**
4. **Frontend looks for these events to show attribution**
5. **Missing events = "Source unknown" warnings**

For implementation details, see `BACKEND_PROVENANCE_FIX_GUIDE.md`
