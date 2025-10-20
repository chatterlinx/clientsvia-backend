# ClientsVia Call Flow Architecture

**Purpose**: Complete end-to-end call flow from customer dial to AI response  
**Last Updated**: October 20, 2025

---

## 📞 Complete Call Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: CALL INITIATION & COMPANY IDENTIFICATION                           │
└──────────────────────────────────────────────────────────────────────────────┘

1. Customer Dials: +1-239-232-2030
         ↓
2. Twilio Receives Call
   - Checks configured webhook URL
   - POST /api/twilio/v2-voice-webhook/:companyId
         ↓
3. ClientsVia Backend: Phone Number Lookup
   ┌─────────────────────────────────────────────────────────────┐
   │  🔍 LOOKUP STRATEGY:                                        │
   │                                                              │
   │  A. Check Redis: company-phone:+12392322030                │
   │     └─ Hit? → Return company data (<5ms) ⚡                 │
   │                                                              │
   │  B. Redis Miss? → Query MongoDB                            │
   │     - Find company where twilioConfig.phoneNumbers         │
   │       contains +12392322030                                │
   │     - Cache result in Redis (TTL: 1 hour)                  │
   │     - Return company data (~100ms first time)              │
   │                                                              │
   │  C. Not Found? → Return 404 error                          │
   └─────────────────────────────────────────────────────────────┘
         ↓
4. Company Identified: "Royal Plumbing"
   - Company ID: 68e3f77a9d623b8058c700c4
   - Trade: Plumbing
   - Status: Active
         ↓

┌──────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: ACCOUNT STATUS CHECK & ROUTING                                     │
└──────────────────────────────────────────────────────────────────────────────┘

5. Check accountStatus.status:
   
   ┌─────────────────────────────────────────────────────────────┐
   │  🟢 ACTIVE:                                                  │
   │     → Proceed to greeting (normal flow)                     │
   │                                                              │
   │  🟡 CALL_FORWARD:                                           │
   │     → Play custom message:                                  │
   │       "Thank you for calling {Company Name}..."             │
   │     → Forward to accountStatus.callForwardNumber            │
   │     → End call (Twilio handles forward)                     │
   │                                                              │
   │  🔴 SUSPENDED:                                              │
   │     → Play: "This service is temporarily unavailable"       │
   │     → End call                                              │
   │                                                              │
   │  ⚪ PAUSED:                                                  │
   │     → Play: "Service paused. Please try again later."       │
   │     → End call                                              │
   └─────────────────────────────────────────────────────────────┘
         ↓ (Assuming ACTIVE)

┌──────────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: GREETING GENERATION & DELIVERY                                     │
└──────────────────────────────────────────────────────────────────────────────┘

6. Load Connection Messages (aiAgentLogic.connectionMessages.voice)
   
   ┌─────────────────────────────────────────────────────────────┐
   │  CONNECTION MESSAGE STRUCTURE:                              │
   │                                                              │
   │  {                                                           │
   │    mode: "realtime",      // or "pre_rendered"             │
   │    text: "Thank you for calling Royal Plumbing...",        │
   │    fallback: "inline_tts", // or "default"                 │
   │    realtime: {                                              │
   │      text: "...",                                           │
   │      variation: "professional" // or "friendly"            │
   │    },                                                        │
   │    preRendered: {                                           │
   │      audioUrl: "https://...",                              │
   │      s3Key: "greetings/..."                                │
   │    }                                                         │
   │  }                                                           │
   └─────────────────────────────────────────────────────────────┘
         ↓
7. Greeting Mode Decision:
   
   IF mode === "pre_rendered" AND preRendered.audioUrl exists:
       → Play pre-recorded audio directly
       → Faster (<1s), no TTS delay
   
   ELSE IF mode === "realtime":
       → Generate TTS via ElevenLabs
       → Process text through placeholder replacement
       → Stream voice to customer
         ↓
8. Placeholder Replacement:
   
   Text: "Thank you for calling {Company Name}. We're {Status}..."
         ↓
   Replace {Company Name} → "Royal Plumbing"
   Replace {Status} → "available 24/7"
   Replace {Phone} → company.businessPhone
         ↓
   Final: "Thank you for calling Royal Plumbing. We're available 24/7..."
         ↓
9. Voice Generation (if realtime):
   
   ┌─────────────────────────────────────────────────────────────┐
   │  ELEVENLABS TTS REQUEST:                                    │
   │                                                              │
   │  POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}│
   │                                                              │
   │  Headers:                                                    │
   │    xi-api-key: [ClientsVia Global API Key OR Company Key]  │
   │                                                              │
   │  Body:                                                       │
   │    text: "Thank you for calling Royal Plumbing..."         │
   │    model_id: "eleven_turbo_v2_5"                           │
   │    voice_settings: {                                        │
   │      stability: 0.5,                                        │
   │      similarity_boost: 0.7,                                 │
   │      style: 0,                                              │
   │      use_speaker_boost: true                                │
   │    }                                                         │
   │                                                              │
   │  Response: Audio stream (MP3, 44.1kHz, 128kbps)            │
   └─────────────────────────────────────────────────────────────┘
         ↓
10. Voice Settings (aiAgentLogic.voiceSettings):
    
    ┌─────────────────────────────────────────────────────────────┐
    │  {                                                           │
    │    apiSource: "clientsvia",  // or "own_api"               │
    │    apiKey: null,            // Company's key (if own_api)  │
    │    voiceId: "UgBBYS2sOqTuMpoF3BR0",  // Mark (ElevenLabs) │
    │    stability: 0.5,                                          │
    │    similarityBoost: 0.7,                                    │
    │    styleExaggeration: 0,                                    │
    │    speakerBoost: true,                                      │
    │    aiModel: "eleven_turbo_v2_5",                           │
    │    outputFormat: "mp3_44100_128",                          │
    │    streamingLatency: 0  // 0=speed, 4=quality              │
    │  }                                                           │
    └─────────────────────────────────────────────────────────────┘
         ↓
11. Greeting Plays to Customer
    Time: ~2-3 seconds
         ↓

┌──────────────────────────────────────────────────────────────────────────────┐
│  PHASE 4: CUSTOMER INPUT & AI PROCESSING                                     │
└──────────────────────────────────────────────────────────────────────────────┘

12. Customer Speaks: "What are your hours?"
         ↓
13. Twilio Speech-to-Text:
    - Converts voice → text
    - Sends to ClientsVia via webhook
    - Input: { speech: "What are your hours?" }
         ↓
14. AI Core Processing (v2AIAgentRuntime.js):
    
    ┌─────────────────────────────────────────────────────────────┐
    │  🧠 KNOWLEDGE ROUTING PRIORITY:                             │
    │                                                              │
    │  Priority 0: INSTANT RESPONSES (Small Talk)                │
    │     - "Hello", "Hi", "Thank you", "Goodbye"                │
    │     - No DB lookup needed                                   │
    │     - Confidence: N/A                                       │
    │     ├─ Match? → Return instant response                    │
    │     └─ No match? → Continue to Priority 1                  │
    │                                                              │
    │  Priority 1: COMPANY Q&A (Highest)                         │
    │     - Query: Company-specific Q&A                          │
    │     - Scope: companyId only                                │
    │     - Confidence Threshold: ≥0.8                           │
    │     ├─ Match? → Return company answer                      │
    │     └─ No match? → Continue to Priority 2                  │
    │                                                              │
    │  Priority 2: TRADE Q&A (Industry-Specific)                 │
    │     - Query: Trade category Q&A (e.g., Plumbing)          │
    │     - Scope: company.aiAgentLogic.selectedTrade            │
    │     - Confidence Threshold: ≥0.75                          │
    │     ├─ Match? → Return trade answer                        │
    │     └─ No match? → Continue to Priority 3                  │
    │                                                              │
    │  Priority 3: TEMPLATES (Structured Responses)              │
    │     - Query: Global + Company templates                    │
    │     - Confidence Threshold: ≥0.7                           │
    │     ├─ Match? → Return template answer                     │
    │     └─ No match? → Continue to Priority 4                  │
    │                                                              │
    │  Priority 4: IN-HOUSE FALLBACK (Keyword Matching)          │
    │     - Query: Keyword-based fallback system                 │
    │     - Confidence Threshold: ≥0.5                           │
    │     - ALWAYS returns a response (no dead ends)             │
    │     └─ Return fallback answer                              │
    └─────────────────────────────────────────────────────────────┘
         ↓
15. Example Match Process for "What are your hours?":
    
    Step 1: Check Instant Responses
            → No match (not small talk)
    
    Step 2: Check Company Q&A
            → Search company:68e3f77a9d623b8058c700c4 Q&As
            → Find: "What are your hours?"
            → Answer: "We're open Monday-Friday 8am-6pm, Saturday 9am-2pm"
            → Confidence: 0.95
            → THRESHOLD MET (≥0.8) ✅
            → RETURN THIS ANSWER
         ↓
16. Answer Retrieved (from Company Q&A):
    "We're open Monday-Friday 8am-6pm, Saturday 9am-2pm. 
     We also offer emergency services 24/7."
         ↓

┌──────────────────────────────────────────────────────────────────────────────┐
│  PHASE 5: RESPONSE GENERATION & VOICE DELIVERY                               │
└──────────────────────────────────────────────────────────────────────────────┘

17. Placeholder Replacement in Answer:
    "We're open {Business Hours}..." → "We're open Monday-Friday 8am-6pm..."
         ↓
18. Send to ElevenLabs TTS:
    - Same voice settings as greeting
    - Same API key (ClientsVia Global or Company)
    - Streaming enabled for faster response
         ↓
19. Voice Generated & Streamed:
    Time: ~2 seconds
         ↓
20. Voice Plays to Customer
         ↓

┌──────────────────────────────────────────────────────────────────────────────┐
│  PHASE 6: CALL CONTINUATION OR TERMINATION                                   │
└──────────────────────────────────────────────────────────────────────────────┘

21. Wait for Customer Response:
    
    A. Customer asks another question
       → Loop back to Phase 4 (AI Processing)
    
    B. Customer says goodbye
       → Play farewell message
       → End call
    
    C. Silence timeout (30 seconds)
       → Play: "Are you still there?"
       → Wait 10 more seconds
       → End call if no response
    
    D. Customer hangs up
       → Twilio sends status callback
       → Log call details to database
         ↓
22. Call Log Saved (v2AIAgentCallLog):
    {
      companyId: "68e3f77a9d623b8058c700c4",
      callSid: "CA1234...",
      from: "+15551234567",
      to: "+12392322030",
      duration: 120,
      status: "completed",
      transcript: [...],
      aiResponses: [...],
      createdAt: Date
    }
         ↓
23. End of Call Flow ✅
```

---

## 🔄 Alternative Flows

### **Flow A: Spam Call Detected**

```
Customer Calls
     ↓
Phone Lookup
     ↓
Spam Filter Check (if callFiltering.enabled)
     ├─ checkGlobalSpamDB: true
     │  └─ Number in global spam database?
     │     └─ YES → Block call, return busy signal
     │
     ├─ enableFrequencyCheck: true
     │  └─ More than 5 calls in 10 minutes?
     │     └─ YES → Block call
     │
     └─ enableRobocallDetection: true
        └─ AI pattern matches robocall?
           └─ YES → Block call

If blocked:
     → Log to callFiltering.stats
     → Increment totalBlocked
     → Return <Response><Reject/></Response> to Twilio
```

### **Flow B: Call Forward (Maintenance Mode)**

```
Customer Calls
     ↓
Phone Lookup
     ↓
Account Status Check
     ↓
Status: "call_forward"
     ↓
Play Message:
     "Thank you for calling Royal Plumbing. 
      We're currently performing system maintenance. 
      Your call is being forwarded to our emergency line..."
     ↓
<Dial>{accountStatus.callForwardNumber}</Dial>
     ↓
Twilio Connects to Forward Number
     ↓
End (ClientsVia not involved in forwarded conversation)
```

### **Flow C: Pre-Rendered Greeting (Faster)**

```
Customer Calls
     ↓
Phone Lookup
     ↓
Greeting Mode: "pre_rendered"
     ↓
Load preRendered.audioUrl:
     "https://clientsvia-greetings.s3.amazonaws.com/..."
     ↓
Twilio Plays Audio Directly (<1s, no TTS delay)
     ↓
Continue to AI Processing
```

---

## ⏱️ Performance Benchmarks

| Phase | Operation | Target Time | Actual Avg |
|-------|-----------|-------------|------------|
| 1 | Phone Lookup (Redis Hit) | <5ms | 3ms ⚡ |
| 1 | Phone Lookup (Redis Miss) | <100ms | 85ms |
| 2 | Account Status Check | <1ms | <1ms |
| 3 | Greeting Load | <10ms | 7ms |
| 3 | ElevenLabs TTS (streaming) | <2s | 1.8s |
| 4 | AI Knowledge Match (Redis) | <30ms | 22ms ⚡ |
| 4 | AI Knowledge Match (DB) | <150ms | 120ms |
| 5 | Response TTS (streaming) | <2s | 1.9s |

**Total Call Answer Time**: ~3.5 seconds (greeting + first AI response)

---

## 🎤 Voice Settings Deep Dive

### **API Source Options**

```javascript
// Option 1: ClientsVia Global Account (Default)
{
  apiSource: "clientsvia",
  apiKey: null,  // Uses platform's global key
  // Pros: No setup, works immediately
  // Cons: Shared rate limits across all companies
}

// Option 2: Company's Own ElevenLabs Account
{
  apiSource: "own_api",
  apiKey: "sk_abc123...",  // Company's key
  // Pros: Dedicated rate limits, custom voices
  // Cons: Requires company to have ElevenLabs account
}
```

### **Voice Selection**

**Available Voices (ElevenLabs):**
- Mark (Natural Conversations) - Default
- Sarah (Professional)
- Roger (Deep, Authoritative)
- Rachel (Warm, Friendly)
- + 17 more

**Selection Process:**
1. Admin goes to "AI Voice Settings" tab
2. Clicks "Load Voices" button
3. Backend fetches from ElevenLabs API
4. Displays voice samples with "Try Voice" button
5. Admin selects voice → Saves voiceId

### **Fallback Strategy**

```
Primary: Realtime TTS via ElevenLabs
     ↓ (If fails)
Fallback 1: Pre-rendered audio (if available)
     ↓ (If fails)
Fallback 2: Twilio's built-in TTS (basic)
     ↓ (If fails)
Final: Play generic message + end call
```

---

**Next Document**: [Data Architecture →](./DATA-ARCHITECTURE.md)

