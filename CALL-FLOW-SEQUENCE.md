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

#### 6A. **STT Preprocessing**
- Clean up transcription
- Remove filler words ("um", "uh")
- Apply corrections
- **Service:** `STTPreprocessor`

#### 6B. **Load Call State**
- Retrieve conversation history
- Get customer context
- Check if returning customer
- **Service:** `CallRuntime` + `StateStore`

#### 6C. **AI Brain Decides**
- Parse customer intent
- Determine next action
- Generate response
- **Service:** `HybridReceptionistLLM` → OpenAI GPT-4

**Brain Flow:**
```
Customer Input → LLM → Intent Analysis → Response Generation
```

#### 6D. **Route to Action**
Options:
1. **Ask Question** - Need more info
2. **Run Scenario** - Execute booking flow
3. **Transfer Call** - Route to human
4. **Answer Question** - Provide information

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
│  │  → Clean STT result                                     │  │
│  │  → Load call state                                      │  │
│  │  → HybridReceptionistLLM → OpenAI                       │  │
│  │  → Parse intent                                         │  │
│  │  → Generate response text                               │  │
│  │  → Service: CallRuntime + LLM                           │  │
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
