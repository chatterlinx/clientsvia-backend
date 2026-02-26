# Complete Call Flow Sequence

## The Journey: From Ring to Response

```
📞 Customer Calls → Twilio → Your Server → AI Agent → Customer Hears Response
```

---

## Step-by-Step Flow

### 🎯 **STEP 1: Call Enters System**

**Endpoint:** `POST /api/twilio/voice` (main entry point)

**What Happens:**
1. Twilio receives inbound call
2. Twilio webhook calls: `POST https://your-server/api/twilio/voice`
3. Server loads company from database
4. Initializes call tracking & logging

**Code Location:** `routes/v2twilio.js` ~Line 1515

---

### 👋 **STEP 2: Generate Greeting**

**Service:** `initializeCall()` from `v2AIAgentRuntime`

**What Happens:**
1. Call `initializeCall(companyId, callSid, from, to)`
2. Loads company greeting configuration
3. Checks if customer is returning (Call Center V2)
4. Personalizes greeting if returning customer detected
   - Example: "Hi John! Welcome back to ABC Company..."
5. Returns: `{ greeting: "text", voiceSettings: {...} }`

**Code Location:** `routes/v2twilio.js` Line 1521-1557

---

### 🎤 **STEP 3: Convert Greeting to Speech (TTS)**

**Service:** ElevenLabs `synthesizeSpeech()`

**What Happens:**
1. Take greeting text
2. Format for natural pronunciation (phone numbers, addresses)
3. Call ElevenLabs API
4. Get audio buffer (MP3)
5. Save to temporary file or stream

**Code Location:** `routes/v2twilio.js` Line ~1772  
**TTS Service:** `services/v2elevenLabsService.js`

**Input:** `"Welcome to ABC Plumbing! How can I help you today?"`  
**Output:** MP3 audio file

---

### 📢 **STEP 4: Play Greeting + Start Listening**

**TwiML:** `<Gather>` + `<Play>`

**What Happens:**
1. Generate TwiML response with:
   - `<Gather>` - Listen for customer speech
   - `<Play>` - Play greeting audio
   - `action` URL - Where to send speech result
2. Send TwiML back to Twilio
3. Twilio plays greeting to customer
4. Twilio starts listening for response

**Code Location:** `routes/v2twilio.js` Line 1585-1660

**TwiML Example:**
```xml
<Response>
  <Gather 
    input="speech" 
    action="https://your-server/api/twilio/v2-agent-respond/123456"
    timeout="7"
    speechTimeout="auto"
  >
    <Play>https://your-server/greeting-audio.mp3</Play>
  </Gather>
</Response>
```

**Key Settings:**
- `input="speech"` - Listen for voice
- `timeout="7"` - Wait 7 seconds for speech
- `speechTimeout="auto"` - Auto-detect when customer stops talking
- `action="/v2-agent-respond"` - Where to send result

---

### 🎧 **STEP 5: Customer Speaks**

**What Happens:**
1. Customer hears greeting
2. Customer responds: "I need to schedule a service"
3. Twilio captures audio
4. Twilio transcribes speech → text (STT via Deepgram)
5. Twilio POSTs result to `action` URL

**Twilio's POST to action URL contains:**
```javascript
{
  CallSid: "CA123...",
  From: "+12395652202",
  SpeechResult: "I need to schedule a service",
  Confidence: 0.95
}
```

---

### 🧠 **STEP 6: AI Processes Request**

**Endpoint:** `POST /api/twilio/v2-agent-respond/:companyID`

**Code Location:** `routes/v2twilio.js` Line 3426

**What Happens:**

#### 6A. **STT Preprocessing (First Pass)**
**Service:** `STTPreprocessor`
**Code:** `services/STTPreprocessor.js`

**What it does:**
1. Remove filler words: "um", "uh", "like", "you know"
2. Apply mishear corrections: "acee" → "ac"
3. Detect impossible words
4. Clean up transcript quality

**Example:**
- Input: "um I need uh to schedule a service you know"
- Output: "I need to schedule a service"

#### 6Aa. **Vocabulary Normalization (CRITICAL!)**
**Service:** `Agent2VocabularyEngine`
**Code:** `services/engine/agent2/Agent2VocabularyEngine.js`

**This happens INSIDE Agent2DiscoveryRunner BEFORE triggers!**

**Two modes:**

##### **1. HARD_NORMALIZE** - Replace mishears/slang
```
"tstat" → "thermostat"
"acee unit" → "ac unit"
"furniss" → "furnace"
```

##### **2. SOFT_HINT** - Add context hints
```
"the thingy on the wall" → hint: "maybe_thermostat"
"the box outside" → hint: "maybe_outdoor_unit"
```

**Why this matters:**
- Customer says: "My acee isn't working"
- STT transcribes: "my acee isn't working"
- Vocabulary normalizes: "my **ac** isn't working"
- NOW triggers can match "ac" keywords!

**Config Location:** Agent Console → Agent 2.0 → Discovery → Vocabulary

#### 6B. **Load Call State**
- Retrieve conversation history
- Get customer context
- Check if returning customer
- **Service:** `CallRuntime` + `StateStore`

#### 6C. **Call Runtime Orchestration**
**Service:** `CallRuntime.processTurn()`
**Code:** `services/engine/CallRuntime.js`

The runtime routes to **one of two modes**:

##### **MODE 1: DISCOVERY (Default)**
This is where **TRIGGERS are evaluated!**

**Service:** `Agent2DiscoveryRunner`
**Code:** `services/engine/agent2/Agent2DiscoveryRunner.js`

**Flow:**
```
User Input: "I need to schedule a service"
   ↓
1. Normalize text (vocabulary corrections)
   ↓
2. TRIGGER CARD MATCHING ← THIS IS WHERE TRIGGERS ARE CHECKED!
   Service: TriggerCardMatcher.match()
   ↓
3. Check ALL trigger cards (keywords, phrases, negatives)
   - Keywords: word-based matching (all words must be present)
   - Phrases: exact substring matching
   - Negatives: exclude if negative keywords found
   ↓
4. First matching card wins (by priority)
   ↓
5. Return trigger card response (text + optional audio)
```

**Trigger Matching Logic:**
- **Keyword Match:** "schedule service" 
  - Input: "I need to schedule a service" → ✅ MATCH
- **Negative Keywords:** "cancel", "reschedule"
  - If found → ❌ SKIP this card
- **Greeting Protection:** "hi" only matches short utterances
  - "hi" → ✅ MATCH
  - "hi my AC is broken" → ❌ NO MATCH (real intent)

##### **MODE 2: BOOKING**
If already in booking flow, uses `BookingLogicEngine` instead.

#### 6D. **Trigger Card Response**

If trigger matched:
- Return pre-configured response text
- Return optional pre-recorded audio URL
- **Source:** Agent Console → Triggers page

If no trigger matched:
- Fall back to LLM (HybridReceptionistLLM)
- Generate dynamic response via GPT-4

#### 6E. **Route to Action**
Options:
1. **Trigger Card Match** - Use pre-configured response (FAST!)
2. **LLM Fallback** - Generate dynamic response (FLEXIBLE!)
3. **Booking Flow** - Execute multi-step booking
4. **Transfer Call** - Route to human

---

### 💬 **STEP 7: Generate AI Response**

**What Happens:**
1. LLM returns response text
   - Example: "I'd be happy to help you schedule a service! What day works best for you?"
2. Check for cached instant response
3. Format text for TTS
4. Log conversation turn

**Code Location:** `routes/v2twilio.js` Line ~2800-2900

---

### 🔊 **STEP 8: Convert Response to Speech**

**Service:** ElevenLabs `synthesizeSpeech()`

**What Happens:**
1. Take AI response text
2. Format for pronunciation
3. Call ElevenLabs API
4. Get audio buffer
5. Cache if needed

**Code Location:** `routes/v2twilio.js` Line 2804

**Same as Step 3**, but for AI response instead of greeting.

---

### 🔄 **STEP 9: Play Response + Continue Listening**

**TwiML:** `<Gather>` + `<Play>` (again!)

**What Happens:**
1. Generate new TwiML with:
   - `<Play>` AI response audio
   - `<Gather>` Listen for next customer input
   - Same `action` URL for next turn
2. Send TwiML to Twilio
3. Twilio plays response
4. Twilio listens for customer's next input

**This is a LOOP!**

```
┌─────────────────────────────────────┐
│  Customer Speaks                    │
│         ↓                            │
│  Twilio STT → Text                  │
│         ↓                            │
│  POST /v2-agent-respond             │
│         ↓                            │
│  AI Brain Processes                 │
│         ↓                            │
│  Generate Response Text             │
│         ↓                            │
│  ElevenLabs TTS → Audio             │
│         ↓                            │
│  TwiML: <Play> + <Gather>           │
│         ↓                            │
│  Twilio Plays Audio                 │
│         ↓                            │
│  Twilio Listens...                  │
│         ↓                            │
│  [Back to Top - Customer Speaks]    │
└─────────────────────────────────────┘
```

---

## 🔍 **THE PREPROCESSING FUNNEL (After Gather, Before Triggers)**

**YES! This is a critical funnel that happens between Gather and Trigger evaluation.**

```
┌─────────────────────────────────────────────────────────────┐
│  RAW SPEECH RESULT FROM TWILIO                              │
│  "um I need uh to schedule my acee you know"                │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: STTPreprocessor (Template-level)                   │
│  ─────────────────────────────────────────────────────────  │
│  ✓ Remove fillers: "um", "uh", "you know"                   │
│  ✓ Apply mishear corrections from STT Profile               │
│  ✓ Detect impossible words                                  │
│  ─────────────────────────────────────────────────────────  │
│  Result: "I need to schedule my acee"                        │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: Agent2VocabularyEngine (Agent 2.0 Discovery)       │
│  ─────────────────────────────────────────────────────────  │
│  ✓ HARD_NORMALIZE: Replace slang/mishears                   │
│     "acee" → "ac"                                            │
│     "tstat" → "thermostat"                                   │
│  ✓ SOFT_HINT: Add context hints                             │
│     "thingy on wall" → hint: "maybe_thermostat"             │
│  ─────────────────────────────────────────────────────────  │
│  Result: "I need to schedule my ac"                          │
│  Hints: []                                                   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: TriggerCardMatcher.match()                         │
│  ─────────────────────────────────────────────────────────  │
│  ✓ Check keywords: ["schedule", "ac"]                       │
│  ✓ Check phrases: "schedule service"                        │
│  ✓ Check negative keywords: ["cancel"]                      │
│  ✓ Apply greeting protection                                │
│  ✓ Use hints for priority boost                             │
│  ─────────────────────────────────────────────────────────  │
│  Match Found: "AC Service Scheduling" trigger card          │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  RESPONSE: Use trigger card response                         │
│  "I'd be happy to help with your AC! When did it stop        │
│  working?"                                                   │
└─────────────────────────────────────────────────────────────┘
```

### **Processing Order (Critical!)**

```
1. Raw STT → "um I need uh to schedule my acee you know"
   ↓
2. STTPreprocessor → "I need to schedule my acee"
   ↓
3. Agent2VocabularyEngine → "I need to schedule my ac"
   ↓
4. TriggerCardMatcher → MATCH! "AC Service" trigger
   ↓
5. Return trigger response (fast path!)
```

### **Where These Services Live**

| Service | Location | Config UI |
|---------|----------|-----------|
| STTPreprocessor | `services/STTPreprocessor.js` | STT Profile page |
| Agent2VocabularyEngine | `services/engine/agent2/Agent2VocabularyEngine.js` | Agent 2.0 → Vocabulary |
| TriggerCardMatcher | `services/engine/agent2/TriggerCardMatcher.js` | Agent 2.0 → Triggers |

---

## 🎯 **TRIGGERS: When & How They're Evaluated**

### **Trigger Evaluation Point**

**When:** Inside `/v2-agent-respond` endpoint, BEFORE LLM  
**Where:** `Agent2DiscoveryRunner.run()` → `TriggerCardMatcher.match()`  
**Code:** `services/engine/agent2/TriggerCardMatcher.js`

### **The Trigger Matching Process**

```
Customer Speech: "I need to schedule a service"
        ↓
STT Result: "I need to schedule a service"
        ↓
POST /v2-agent-respond
        ↓
CallRuntime.processTurn()
        ↓
Agent2DiscoveryRunner.run()
        ↓
[🎯 TRIGGER EVALUATION HAPPENS HERE]
TriggerCardMatcher.match()
        ↓
Loop through ALL trigger cards (sorted by priority):
  For each card:
    1. Check if enabled ✓
    2. Check negative keywords (skip if found) ✗
    3. Check keywords (word-based matching) ✓
    4. Check phrases (substring matching) ✓
    5. First match wins! 🎉
        ↓
If matched:
  → Return trigger card response
  → Use pre-recorded audio (if exists)
  → SKIP LLM (faster response!)
        ↓
If no match:
  → Fall back to LLM (HybridReceptionistLLM)
  → GPT-4 generates dynamic response
```

### **Trigger Card Structure**

From Agent Console → Triggers page:

```javascript
{
  id: "card_123",
  label: "Schedule Service",
  enabled: true,
  priority: 100,
  
  // Matching Rules
  keywords: ["schedule", "appointment", "service"],
  phrases: ["book appointment", "set up service"],
  negativeKeywords: ["cancel", "reschedule"],
  
  // Response
  responseText: "I'd be happy to help schedule a service! What day works best?",
  audioUrl: "/trigger-audio/schedule-123.mp3" // Optional
}
```

### **Matching Examples**

| Customer Says | Trigger Keywords | Match? |
|---------------|------------------|--------|
| "I need to schedule a service" | ["schedule", "service"] | ✅ YES |
| "Can I book an appointment?" | ["book", "appointment"] | ✅ YES |
| "I want to cancel my appointment" | ["cancel"] (negative) | ❌ NO (blocked by negative) |
| "hi my AC is broken" | ["hi"] (greeting) | ❌ NO (greeting protection) |
| "hi" | ["hi"] (greeting) | ✅ YES (short utterance) |

### **Why Triggers Matter**

✅ **Ultra-fast responses** - No LLM call needed (saved ~1-2 seconds)  
✅ **Consistent messaging** - Same response every time  
✅ **Pre-recorded audio** - Skip TTS entirely (instant playback)  
✅ **Deterministic** - No AI hallucinations or variations  
✅ **Cost savings** - No OpenAI API calls for common requests  

### **Trigger Priority**

Triggers evaluated in **priority order** (highest first):
1. Priority 100 (highest)
2. Priority 90
3. Priority 80
...
n. Priority 1 (lowest)

**First match wins** - Once a trigger matches, evaluation stops.

---

## Complete Flow Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                    CUSTOMER CALLS                             │
│                         ↓                                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  TWILIO RECEIVES CALL                                   │  │
│  │  → Webhook to /api/twilio/voice                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                         ↓                                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  INITIALIZE CALL                                        │  │
│  │  → Load company                                         │  │
│  │  → Check returning customer                             │  │
│  │  → Generate greeting text                               │  │
│  │  → Service: initializeCall()                            │  │
│  └────────────────────────────────────────────────────────┘  │
│                         ↓                                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  GREETING TTS                                           │  │
│  │  → Text → ElevenLabs API                                │  │
│  │  → Get audio MP3                                        │  │
│  │  → Service: synthesizeSpeech()                          │  │
│  └────────────────────────────────────────────────────────┘  │
│                         ↓                                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  PLAY GREETING + LISTEN                                 │  │
│  │  → TwiML: <Gather><Play>greeting.mp3</Play></Gather>   │  │
│  │  → action="/v2-agent-respond"                           │  │
│  │  → Twilio plays greeting to customer                    │  │
│  │  → Twilio starts listening                              │  │
│  └────────────────────────────────────────────────────────┘  │
│                         ↓                                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  CUSTOMER SPEAKS                                        │  │
│  │  → "I need to schedule a service"                       │  │
│  │  → Twilio captures audio                                │  │
│  │  → Deepgram transcribes (STT)                           │  │
│  └────────────────────────────────────────────────────────┘  │
│                         ↓                                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  TWILIO POSTS TO ACTION URL                             │  │
│  │  → POST /v2-agent-respond                               │  │
│  │  → Body: { SpeechResult: "text..." }                    │  │
│  └────────────────────────────────────────────────────────┘  │
│                         ↓                                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  AI BRAIN PROCESSES                                     │  │
│  │  → Clean STT result (STTPreprocessor)                   │  │
│  │  → Load call state (StateStore)                         │  │
│  │  → CallRuntime.processTurn()                            │  │
│  │    ├─→ Agent2DiscoveryRunner.run()                      │  │
│  │    │   ├─→ [🎯 TRIGGER EVALUATION]                      │  │
│  │    │   │   TriggerCardMatcher.match()                   │  │
│  │    │   │   - Check keywords/phrases                     │  │
│  │    │   │   - Check negative keywords                    │  │
│  │    │   │   - Priority-based matching                    │  │
│  │    │   │                                                 │  │
│  │    │   ├─→ IF MATCHED:                                  │  │
│  │    │   │   → Use trigger response text                  │  │
│  │    │   │   → Use pre-recorded audio (if exists)         │  │
│  │    │   │   → SKIP LLM (instant response!)               │  │
│  │    │   │                                                 │  │
│  │    │   └─→ IF NO MATCH:                                 │  │
│  │    │       → HybridReceptionistLLM → OpenAI GPT-4       │  │
│  │    │       → Generate dynamic response                  │  │
│  │    │                                                     │  │
│  │    └─→ OR BookingLogicEngine (if in booking mode)       │  │
│  │                                                           │  │
│  │  → Response text ready                                   │  │
│  └────────────────────────────────────────────────────────┘  │
│                         ↓                                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  RESPONSE TTS                                           │  │
│  │  → Response text → ElevenLabs API                       │  │
│  │  → Get audio MP3                                        │  │
│  │  → Service: synthesizeSpeech()                          │  │
│  └────────────────────────────────────────────────────────┘  │
│                         ↓                                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  PLAY RESPONSE + LISTEN AGAIN                           │  │
│  │  → TwiML: <Gather><Play>response.mp3</Play></Gather>   │  │
│  │  → Same action="/v2-agent-respond"                      │  │
│  │  → LOOP CONTINUES...                                    │  │
│  └────────────────────────────────────────────────────────┘  │
│                         ↓                                     │
│                 [REPEAT FROM "CUSTOMER SPEAKS"]               │
└──────────────────────────────────────────────────────────────┘
```

---

## Key Endpoints

| Route | Purpose | Called By |
|-------|---------|-----------|
| `POST /api/twilio/voice` | Initial call entry | Twilio (webhook) |
| `POST /api/twilio/v2-agent-respond/:companyID` | Process customer speech → Generate response | Twilio (`<Gather action>`) |
| `POST /api/twilio/status-callback/:companyID` | Call ended notification | Twilio (call completion) |

---

## Services Used Per Step

### **Step 2-3: Greeting**
- `v2AIAgentRuntime.initializeCall()` - Generate greeting text
- `v2elevenLabsService.synthesizeSpeech()` - Text → Audio

### **Step 6: AI Processing**
- `STTPreprocessor` - Clean transcription
- `CallRuntime` - Manage conversation state
- `StateStore` - Store/retrieve call data
- `HybridReceptionistLLM` - AI brain (GPT-4)
- `ConversationEngine` - Orchestrate flow

### **Step 8: Response**
- `v2elevenLabsService.synthesizeSpeech()` - Text → Audio

---

## The Magic: `<Gather>` Loop

Every response includes:

```xml
<Gather 
  input="speech"
  action="/v2-agent-respond/:companyID"
  timeout="7"
  speechTimeout="auto"
>
  <Play>response-audio.mp3</Play>
</Gather>
```

**This creates the conversation loop:**
1. Play response
2. Listen for customer
3. Customer speaks
4. POST to `/v2-agent-respond`
5. Process → Generate new response
6. Return new `<Gather>` with new audio
7. **Repeat infinitely** until call ends

---

## When Does It End?

### Call Ends When:
1. Customer hangs up
2. AI says `<Hangup>` in TwiML
3. Transfer completes (`<Dial>`)
4. Timeout (no speech for extended period)
5. Error occurs

### Status Callback Fired:
- `POST /api/twilio/status-callback/:companyID`
- Twilio sends: `{ CallStatus: "completed", CallDuration: 123 }`
- System generates transcript & call summary

---

## Summary: The Flow in One Sentence

**Customer calls → Greeting plays → Customer speaks → AI processes → Response plays → Listen again → LOOP**

---

## File Locations

| Component | File |
|-----------|------|
| **Main Call Router** | `routes/v2twilio.js` |
| **AI Agent Runtime** | `services/v2AIAgentRuntime.js` |
| **TTS Service** | `services/v2elevenLabsService.js` |
| **Call State Management** | `services/engine/CallRuntime.js` |
| **AI Brain** | `services/HybridReceptionistLLM.js` |
| **STT Processing** | `services/STTPreprocessor.js` |

---

**Generated:** 2026-02-26  
**Purpose:** Complete call flow documentation from ring to conversation loop
