# 🎯 AI AGENT CALL FLOW SEQUENCE
## Complete Architecture & Execution Order

**Last Updated:** 2025-11-13  
**Version:** 2.0 (Cheat Sheet Integration Complete)

---

## 📞 **COMPLETE CALL FLOW (From Ring to Hangup)**

This document describes the EXACT sequence of operations when an incoming call is received by the ClientsVia AI Agent.

---

## 🔢 **PHASE 1: CALL INITIALIZATION**

### **Step 1.1: Call Received**
```
📞 Twilio receives incoming call
   ↓
   Webhook: POST /api/calls/voice
   ↓
   Extract: from, to, callSid, companyId
```

**File:** `routes/calls.js`  
**Function:** `POST /api/calls/voice`

---

### **Step 1.2: Load Company Context**
```
🏢 Fetch company from MongoDB
   ↓
   Load: businessName, templateId, aiAgentSettings
   ↓
   Load: Cheat Sheet (companyInstructions, behaviorRules, edgeCases, transferRules, guardrails)
```

**File:** `services/v2AIAgentRuntime.js`  
**Function:** `initializeCall()`

**Critical Data Loaded:**
- ✅ Company name, phone, address
- ✅ Active template ID
- ✅ **Cheat Sheet configuration** (NEW!)
- ✅ Spam filter settings
- ✅ Call routing preferences

---

### **Step 1.3: Check Spam Filter (Layer 0 - Pre-AI)**
```
🚫 LAYER 0: PHONE NUMBER BLACKLIST/WHITELIST
   ↓
   Check: Is caller on whitelist? → Allow
   Check: Is caller on blacklist? → Block
   Check: Auto-blacklist triggers? → Flag for review
```

**File:** `services/SmartCallFilter.js`  
**Function:** `shouldBlockCall()`

**If blocked:**
- Play rejection message
- Hang up immediately
- Log to call_logs
- **END CALL**

**If allowed:**
- Continue to initialization →

---

### **Step 1.4: Compile Cheat Sheet (If Needed)**
```
📋 Check if Cheat Sheet needs compilation
   ↓
   If checksum missing or status='draft':
      ↓
      PolicyCompiler.compile(companyId)
      ↓
      Build runtime artifact (regex, sorted rules, Sets)
      ↓
      Generate SHA-256 checksum
      ↓
      Store in Redis: policy:{companyId}:v{version}:{checksum}
      ↓
      Update MongoDB: lastCompiledAt, checksum, status='active'
```

**File:** `services/PolicyCompiler.js`  
**Function:** `compile(companyId)`

**Why:** Pre-compile for 10ms runtime performance budget

---

### **Step 1.5: Initialize Session**
```
🗂️ Create or load call session
   ↓
   SessionManager.getSession(callId)
   ↓
   Check L0 cache (LRU in-process) → <1ms
   Check L1 cache (Redis) → 1-2ms
   Check L2 storage (MongoDB) → 10-20ms (cold start only)
   ↓
   Initialize:
      - turnCount: 0
      - capturedEntities: {}
      - conversationHistory: []
      - cheatSheetMeta: {}
```

**File:** `services/SessionManager.js`  
**Function:** `getSession(callId)`

**Session Lifespan:** 1 hour in Redis, persistent in MongoDB

---

### **Step 1.6: Generate Greeting**
```
🎤 Build initial greeting
   ↓
   Use company.aiAgentSettings.voiceGreeting
   ↓
   Replace variables: {companyName}, {hours}
   ↓
   Return TwiML: <Say> greeting + <Gather> for input
```

**File:** `services/v2AIAgentRuntime.js`  
**Function:** `initializeCall()` → returns greeting

**Default:** "Thank you for calling {companyName}. How can I help you today?"

---

## 🗣️ **PHASE 2: CALLER INPUT RECEIVED**

### **Step 2.1: Speech-to-Text**
```
🎙️ Twilio Gather completes
   ↓
   Webhook: POST /api/calls/gather
   ↓
   Extract: SpeechResult (caller's spoken text)
   ↓
   Sanitize and normalize input
```

**File:** `routes/calls.js`  
**Function:** `POST /api/calls/gather`

---

### **Step 2.2: Load Active Session**
```
📂 SessionManager.getSession(callId)
   ↓
   Increment turnCount
   ↓
   Append to conversationHistory[]
```

**File:** `services/v2AIAgentRuntime.js`  
**Function:** `processUserInput()`

---

## 🧠 **PHASE 3: CHEAT SHEET ENGINE (Pre-Processing)**

### **Step 3.1: Load Compiled Policy**
```
📋 Load from Redis: policy:{companyId}:active
   ↓
   Deserialize artifact (convert stored patterns back to RegExp, arrays to Sets)
   ↓
   Pass to CheatSheetEngine.apply()
```

**File:** `services/CheatSheetEngine.js`  
**Function:** `apply(baseResponse, userInput, callState, policyArtifact)`

**Performance Budget:** 10ms max

---

### **Step 3.2: Edge Case Detection (Short-Circuit)**
```
🚨 PRIORITY 1: EDGE CASES (Highest Priority)
   ↓
   For each edgeCase (sorted by priority DESC):
      ↓
      Test triggerPatterns[] against userInput (regex match)
      ↓
      If match found:
         ↓
         ⚠️ SHORT-CIRCUIT: Replace entire response
         ↓
         Auto-blacklist caller (if spam edge case)
         ↓
         Return: { text: edgeCase.responseText, action: edgeCase.action }
         ↓
         🛑 SKIP ALL OTHER PROCESSING (Scenarios, Knowledge, LLM)
         ↓
         GO DIRECTLY TO PHASE 5 (Response Delivery)
```

**File:** `services/CheatSheetEngine.js`  
**Lines:** 98-141

**Use Cases:**
- 🤖 AI telemarketer detection → "We're not interested. Goodbye." + hang up
- 🚨 Emergency keywords → Transfer immediately
- 📞 Robocall detection → Block + blacklist
- ❌ Dead air → "Hello? Are you still there?"

**If Short-Circuit:** 🛑 **END HERE** → Go to Phase 5  
**If No Match:** ➡️ Continue to Step 3.3

---

### **Step 3.3: Transfer Rule Detection**
```
📞 PRIORITY 2: TRANSFER RULES
   ↓
   For each transferRule (sorted by priority DESC):
      ↓
      Match intentTag or triggerPatterns
      ↓
      If match found:
         ↓
         Collect required entities (name, phone, reason)
         ↓
         If all entities collected:
            ↓
            Return: { action: 'transfer', phoneNumber, script }
            ↓
            🛑 SKIP SCENARIOS & LLM
            ↓
            GO DIRECTLY TO PHASE 5 (Transfer)
```

**File:** `services/CheatSheetEngine.js`  
**Lines:** 143-192

**Use Cases:**
- "I need to pay my bill" → Transfer to Billing (after collecting name + phone)
- "This is an emergency" → Transfer to Emergency Line
- "I want to cancel" → Transfer to Service Advisor

**If Transfer Triggered:** 🛑 **END HERE** → Go to Phase 5  
**If No Match:** ➡️ Continue to Phase 4 (Scenario Routing)

---

## 🎯 **PHASE 4: INTELLIGENT ROUTING (3-Tier AI)**

### **Step 4.1: Tier 1 - Keyword Matching (Fastest, Cheapest)**
```
🎯 TIER 1: KEYWORD MATCHING (FREE, <10ms)
   ↓
   Load all active scenarios from template
   ↓
   For each scenario:
      ↓
      Check if userInput contains keywords[]
      ↓
      Check if userInput does NOT contain negativeKeywords[]
      ↓
      Calculate confidence score (Jaccard similarity)
      ↓
      If score >= scenario.minConfidence (default 0.7):
         ↓
         ✅ MATCH FOUND
         ↓
         Return: scenario response + action
         ↓
         GO TO PHASE 5 (Apply Cheat Sheet Post-Processing)
```

**File:** `services/IntelligentRouter.js`  
**Function:** `routeWithKeywords()`

**Example:**
```
Caller: "My AC is not cooling"
Keywords: ["ac", "air conditioning", "not cooling", "warm", "hot"]
Match: ✅ "Repair Service Request" scenario
Confidence: 0.85
```

**If Match Found:** ➡️ Go to Phase 5  
**If No Match:** ⬇️ Escalate to Tier 2

---

### **Step 4.2: Tier 2 - Semantic Q&A Matching (Fast, Cheap)**
```
🔍 TIER 2: SEMANTIC Q&A (FREE, <50ms)
   ↓
   For each scenario with qnaPairs[]:
      ↓
      Calculate semantic similarity (cosine distance)
      ↓
      If similarity >= 0.75:
         ↓
         ✅ MATCH FOUND
         ↓
         Return: scenario.qnaPairs[].answer
         ↓
         GO TO PHASE 5
```

**File:** `services/IntelligentRouter.js`  
**Function:** `routeWithSemanticQA()`

**Example:**
```
Caller: "What are your business hours?"
Q&A Match: "When are you open?" → "We're open Monday-Friday 8am-5pm"
Confidence: 0.82
```

**If Match Found:** ➡️ Go to Phase 5  
**If No Match:** ⬇️ Escalate to Tier 3 (LLM)

---

### **Step 4.3: Tier 3 - LLM Fallback (Slowest, Expensive)**
```
🤖 TIER 3: LLM FALLBACK ($0.50 per call, 500-2000ms)
   ↓
   Build system prompt (4 LAYERS):
      ↓
      LAYER 1: Base Identity
         - "You are a professional AI receptionist for {companyName}"
         - "You are handling {templateName} inquiries"
      ↓
      LAYER 2: Company Instructions (THE "WARM-UP")
         - Load: company.aiAgentSettings.cheatSheet.companyInstructions
         - This adds PERSONALITY & TONE
         - Example: "Always say 'Ok' instead of 'Got it!'"
         - Example: "Extract key request from long stories"
      ↓
      LAYER 3: Behavior Rules (STRUCTURAL POLISH)
         - Load: company.aiAgentSettings.cheatSheet.behaviorRules[]
         - Example: ACK_OK → "Start responses with 'Ok'"
         - Example: POLITE_PROFESSIONAL → "Maintain courteous tone"
      ↓
      LAYER 4: Call Context (CURRENT STATE)
         - User input, conversation history
         - Captured entities: {name: "John", phone: "555-1234"}
   ↓
   Call OpenAI GPT-4 with system prompt + user input
   ↓
   Parse response
   ↓
   Return: LLM-generated text + suggested action
```

**File:** `services/IntelligentRouter.js`  
**Function:** `matchWithLLM()`  
**Lines:** 1113-1167 (buildSystemPrompt)

**🎭 THIS IS WHERE "WARM-UP" HAPPENS!**

**Example System Prompt (Full Assembly):**
```
You are a professional AI receptionist for ABC HVAC.
You are handling HVAC Service inquiries.
Your role is to understand caller needs, provide helpful information, and guide them to the appropriate next step.

════════════════════════════════════════════════════════════
📋 COMPANY-SPECIFIC PROTOCOLS & CONVERSATION GUIDELINES
════════════════════════════════════════════════════════════

[FULL COMPANY INSTRUCTIONS FROM CHEAT SHEET]

🎯 INTENT EXTRACTION (The Storyteller):
Some callers tell long stories before getting to the point. Your job is to:
1. Listen patiently without interrupting
2. Extract the KEY REQUEST from the story
3. Acknowledge their situation briefly
4. Focus on the actionable need

Example Response Pattern:
"Ok, I understand. Sounds like your AC stopped cooling today. Let me get you scheduled for a repair visit right away."

[... rest of company instructions ...]

════════════════════════════════════════════════════════════
🎯 REQUIRED BEHAVIOR RULES (Always Follow)
════════════════════════════════════════════════════════════

✓ Always start your responses with "Ok" to acknowledge the caller (e.g., "Ok, I understand...")
✓ Let the caller finish speaking completely before responding. Be patient with long explanations.
✓ Maintain a courteous, respectful, and professional tone at all times
✓ Always repeat back important details (name, phone, address, appointment time) to confirm accuracy

════════════════════════════════════════════════════════════
If you are unsure or the request is outside your knowledge, politely acknowledge and offer to take a message or transfer to a staff member.
```

**If Match Found:** ➡️ Go to Phase 5  
**If Still No Match:** Return fallback response ("Let me take a message...")

---

## 🎨 **PHASE 5: CHEAT SHEET POST-PROCESSING**

### **Step 5.1: Guardrail Enforcement**
```
🛡️ GUARDRAILS (Content Filtering)
   ↓
   Scan response text for violations:
      ↓
      ❌ NO_PRICES: Remove any "$" or "dollar" mentions
      ❌ NO_PHONE_NUMBERS: Remove phone number patterns
      ❌ NO_URLS: Remove http/https links
      ❌ NO_DIAGNOSES: Remove medical/technical diagnoses
      ❌ NO_LEGAL_ADVICE: Remove legal guidance
   ↓
   Replace violations with neutral alternatives:
      "$150" → "pricing information available from our office"
      "555-1234" → "our office can provide that number"
```

**File:** `services/CheatSheetEngine.js`  
**Function:** `apply()` → Guardrails block

**Lines:** 194-268

---

### **Step 5.2: Behavior Rules Application**
```
🎨 BEHAVIOR RULES (Text Transformation)
   ↓
   Apply each active behavior rule:
      ↓
      ACK_OK: Prepend "Ok, " to response
      CONFIRM_ENTITIES: Append "Can you confirm [entity]?"
      SHORT_SENTENCES: Split long sentences
      USE_COMPANY_NAME: Insert company name naturally
```

**File:** `services/CheatSheetEngine.js`  
**Function:** `apply()` → Behavior block

**Lines:** 270-325

---

### **Step 5.3: Action Allowlist Validation**
```
✅ ACTION ALLOWLIST (Security)
   ↓
   If action is specified (e.g., 'book_appointment'):
      ↓
      Check if action is in allowlist[]
      ↓
      If NOT allowed:
         ↓
         Override action → 'continue'
         ↓
         Log security warning
```

**File:** `services/CheatSheetEngine.js`  
**Lines:** 327-355

**Prevents:** LLM inventing unauthorized actions

---

### **Step 5.4: Update Session State**
```
💾 Save to session:
   ↓
   finalResponse (text)
   finalAction (validated)
   cheatSheetMeta:
      - appliedBlocks: ['edgeCase', 'guardrails', 'behavior']
      - timeMs: 8
      - shortCircuit: true/false
   ↓
   SessionManager.setSession(callId, updatedState)
   ↓
   Write to Redis L1 cache (1-2ms)
   ↓
   Batch write to MongoDB L3 (async, every 5 seconds)
```

**File:** `services/SessionManager.js`  
**Function:** `setSession()`

---

## 📢 **PHASE 6: RESPONSE DELIVERY**

### **Step 6.1: Build TwiML**
```
📱 Generate Twilio Markup Language (TwiML)
   ↓
   <Response>
      <Say voice="Polly.Joanna">
         {finalResponse}
      </Say>
      ↓
      If action='transfer':
         <Dial>{phoneNumber}</Dial>
      ↓
      If action='hangup':
         <Hangup/>
      ↓
      If action='continue':
         <Gather input="speech" timeout="5">
            (wait for next caller input)
         </Gather>
   </Response>
```

**File:** `routes/calls.js`  
**Function:** `POST /api/calls/gather`

---

### **Step 6.2: Log & Monitor**
```
📊 Write to call_logs collection:
   ↓
   - timestamp
   - companyId, callId
   - userInput, aiResponse
   - routingSource (tier1, tier2, tier3, cheatSheet)
   - confidence, latency
   - cheatSheetMeta (which blocks fired)
   - action taken
   ↓
   Emit metrics:
      - TIER1_SUCCESS
      - TIER3_USAGE
      - CHEATSHEET_SHORT_CIRCUIT
      - GUARDRAIL_VIOLATION
```

**File:** `services/v2AIAgentRuntime.js`

---

## 🔁 **PHASE 7: LOOP OR END**

### **Step 7.1: Check Action**
```
🔄 If action='continue':
   ↓
   Return to PHASE 2 (wait for next caller input)
   ↓
   Repeat flow for multi-turn conversation
```

### **Step 7.2: If Transfer**
```
📞 If action='transfer':
   ↓
   Execute Twilio <Dial>
   ↓
   Connect to: transferRule.phoneNumber
   ↓
   Play pre-transfer message
   ↓
   Monitor transfer completion
```

### **Step 7.3: If Hangup**
```
👋 If action='hangup':
   ↓
   Execute Twilio <Hangup>
   ↓
   Write final call log
   ↓
   Clear session from L0 cache
   ↓
   Keep in Redis L1 for 1 hour (for call forensics)
   ↓
   END CALL
```

---

## 📊 **COMPLETE FLOW DIAGRAM**

```
┌─────────────────────────────────────────────────────────────────────┐
│                       📞 INCOMING CALL                              │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 0: SPAM FILTER (Phone Number Blacklist)                      │
│ - Check whitelist/blacklist                                         │
│ - Auto-blacklist detection                                          │
│ → If blocked: HANG UP                                               │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 1: INITIALIZATION                                             │
│ - Load company & template                                           │
│ - Compile cheat sheet (if needed)                                   │
│ - Initialize session                                                │
│ - Deliver greeting                                                  │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 2: RECEIVE INPUT                                              │
│ - Speech-to-Text                                                    │
│ - Load session state                                                │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 3: CHEAT SHEET PRE-PROCESSING                                 │
│                                                                      │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ 🚨 EDGE CASES (Priority: Highest)                            │   │
│ │ - AI telemarketer? → Hang up + blacklist                     │   │
│ │ - Emergency? → Transfer immediately                          │   │
│ │ - Dead air? → "Hello?"                                       │   │
│ │ → If match: SHORT-CIRCUIT → Go to Phase 5 ✋                 │   │
│ └──────────────────────────────────────────────────────────────┘   │
│                                  ↓                                   │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ 📞 TRANSFER RULES (Priority: High)                           │   │
│ │ - "I want to pay my bill" → Billing transfer                 │   │
│ │ - "This is an emergency" → Emergency line                    │   │
│ │ → If match: SKIP SCENARIOS → Go to Phase 5 ✋                │   │
│ └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 4: INTELLIGENT ROUTING (3-Tier AI)                            │
│                                                                      │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ 🎯 TIER 1: KEYWORD MATCHING (FREE, <10ms)                    │   │
│ │ - Check keywords[] & negativeKeywords[]                      │   │
│ │ - Jaccard similarity scoring                                 │   │
│ │ → If match >= 0.7: Use scenario response                     │   │
│ └──────────────────────────────────────────────────────────────┘   │
│                                  ↓                                   │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ 🔍 TIER 2: SEMANTIC Q&A (FREE, <50ms)                        │   │
│ │ - Cosine similarity on qnaPairs[]                            │   │
│ │ → If match >= 0.75: Use Q&A answer                           │   │
│ └──────────────────────────────────────────────────────────────┘   │
│                                  ↓                                   │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ 🤖 TIER 3: LLM FALLBACK ($0.50, 500-2000ms)                  │   │
│ │                                                              │   │
│ │ Build System Prompt (4 LAYERS):                             │   │
│ │ ┌─────────────────────────────────────────────────────────┐ │   │
│ │ │ LAYER 1: Base Identity                                  │ │   │
│ │ │ "You are AI receptionist for {companyName}..."          │ │   │
│ │ └─────────────────────────────────────────────────────────┘ │   │
│ │ ┌─────────────────────────────────────────────────────────┐ │   │
│ │ │ LAYER 2: Company Instructions 🎭 "WARM-UP"              │ │   │
│ │ │ - "Always say 'Ok' instead of 'Got it!'"                │ │   │
│ │ │ - "Extract key request from long stories"               │ │   │
│ │ │ - "Empathize with upset callers"                        │ │   │
│ │ │ - [All protocols from Cheat Sheet]                      │ │   │
│ │ └─────────────────────────────────────────────────────────┘ │   │
│ │ ┌─────────────────────────────────────────────────────────┐ │   │
│ │ │ LAYER 3: Behavior Rules 🎨 "POLISH"                     │ │   │
│ │ │ - ACK_OK, POLITE_PROFESSIONAL, etc.                     │ │   │
│ │ └─────────────────────────────────────────────────────────┘ │   │
│ │ ┌─────────────────────────────────────────────────────────┐ │   │
│ │ │ LAYER 4: Call Context 🎯 "STATE"                        │ │   │
│ │ │ - User input, history, captured entities                │ │   │
│ │ └─────────────────────────────────────────────────────────┘ │   │
│ │                                                              │   │
│ │ → Call OpenAI GPT-4 → Generate response                     │   │
│ └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 5: CHEAT SHEET POST-PROCESSING                                │
│                                                                      │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ 🛡️ GUARDRAILS (Content Filtering)                            │   │
│ │ - Remove prices: "$150" → "pricing info from office"        │   │
│ │ - Remove phone numbers                                       │   │
│ │ - Remove URLs                                                │   │
│ │ - Remove medical/legal advice                                │   │
│ └──────────────────────────────────────────────────────────────┘   │
│                                  ↓                                   │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ 🎨 BEHAVIOR RULES (Text Transformation)                      │   │
│ │ - Prepend "Ok, " (if ACK_OK enabled)                         │   │
│ │ - Confirm entities                                           │   │
│ │ - Short sentences                                            │   │
│ └──────────────────────────────────────────────────────────────┘   │
│                                  ↓                                   │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ ✅ ACTION ALLOWLIST (Security)                                │   │
│ │ - Validate action against allowlist                          │   │
│ │ - Override if unauthorized                                   │   │
│ └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 6: RESPONSE DELIVERY                                          │
│ - Build TwiML (Say/Dial/Hangup/Gather)                             │
│ - Log call data                                                     │
│ - Emit metrics                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 7: LOOP OR END                                                │
│ - Continue? → Back to Phase 2                                       │
│ - Transfer? → Execute <Dial>                                        │
│ - Hangup? → End call + write logs                                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 **KEY ARCHITECTURAL PRINCIPLES**

### **1. Layered Defense (Security)**
```
Layer 0: Phone Number Filter (spam)
Layer 1: Edge Cases (abuse, robocalls)
Layer 2: Transfer Rules (routing)
Layer 3: Scenarios (content)
Layer 4: Guardrails (safety)
Layer 5: Action Allowlist (authorization)
```

### **2. Performance Cascade (Cost Optimization)**
```
Tier 1 (FREE) → 90% of calls
Tier 2 (FREE) → 8% of calls
Tier 3 ($0.50) → 2% of calls (edge cases only)
```

### **3. Precedence Order (Who Wins?)**
```
1. Edge Cases (highest - can override EVERYTHING)
2. Transfer Rules (high - skip scenarios)
3. Tier 1 Keywords (medium - fast match)
4. Tier 2 Semantic (medium - smarter match)
5. Tier 3 LLM (lowest - fallback only)

Post-Processing (always applies):
6. Guardrails (content filtering)
7. Behavior Rules (polish)
8. Action Allowlist (security)
```

### **4. "Warm-Up" Architecture (Natural Conversation)**
```
🎭 Company Instructions (PERSONALITY)
   ↓ Defines HOW to speak
   
📜 Scenarios (CONTENT)
   ↓ Defines WHAT to say
   
🎨 Behavior Rules (POLISH)
   ↓ Defines FINAL TOUCHES
   
Result: "Ok, I understand. Sounds like your AC stopped cooling today. 
Let me get you scheduled for a repair visit right away."

NOT: "Your AC is broken. I will schedule a technician. What is your address?"
```

---

## 📁 **FILE REFERENCE MAP**

| Phase | File | Key Functions |
|-------|------|---------------|
| **Call Init** | `routes/calls.js` | `POST /voice`, `POST /gather` |
| **Spam Filter** | `services/SmartCallFilter.js` | `shouldBlockCall()`, `autoAddToBlacklist()` |
| **Compilation** | `services/PolicyCompiler.js` | `compile()` |
| **Session** | `services/SessionManager.js` | `getSession()`, `setSession()` |
| **Runtime** | `services/v2AIAgentRuntime.js` | `initializeCall()`, `processUserInput()` |
| **Cheat Sheet** | `services/CheatSheetEngine.js` | `apply()` |
| **Routing** | `services/IntelligentRouter.js` | `route()`, `buildSystemPrompt()` |
| **Database** | `models/v2Company.js` | Company schema with `aiAgentSettings.cheatSheet` |

---

## 🔄 **MODIFICATION GUIDE**

### **To Change Call Flow Order:**

1. **Add New Pre-Processing Step:**
   - Edit: `services/v2AIAgentRuntime.js` → `processUserInput()`
   - Insert before or after `CheatSheetEngine.apply()`

2. **Add New Post-Processing Step:**
   - Edit: `services/CheatSheetEngine.js` → `apply()`
   - Add new block after guardrails, before return

3. **Change Precedence:**
   - Edit: `services/CheatSheetEngine.js`
   - Reorder blocks (Edge Cases → Transfer → Guardrails → Behavior)

4. **Modify System Prompt:**
   - Edit: `services/IntelligentRouter.js` → `buildSystemPrompt()`
   - Add/remove layers

5. **Add New Cheat Sheet Rule Type:**
   - Edit: `models/v2Company.js` → Add to `cheatSheet` schema
   - Edit: `services/PolicyCompiler.js` → Add compilation logic
   - Edit: `services/CheatSheetEngine.js` → Add runtime logic
   - Edit: `public/js/ai-agent-settings/CheatSheetManager.js` → Add UI

---

## 🎨 **DYNAMIC FLOWCHART CONCEPT**

### **Your Idea: "Stack and Change Flow"**

This is a BRILLIANT idea for enterprise users! Here's what it could look like:

```
┌─────────────────────────────────────────────────────────────┐
│ AI CALL FLOW DESIGNER (Visual Editor)                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [📞 Incoming Call]                                         │
│         ↓                                                   │
│  ┌─────────────────┐                                        │
│  │ 🚫 Spam Filter  │ [✓ Enabled] [⚙️ Settings]              │
│  └─────────────────┘                                        │
│         ↓                                                   │
│  ┌─────────────────┐                                        │
│  │ 🚨 Edge Cases   │ [✓ Enabled] [⚙️ Configure] [↑ ↓]       │
│  └─────────────────┘                                        │
│         ↓                                                   │
│  ┌─────────────────┐                                        │
│  │ 📞 Transfers    │ [✓ Enabled] [⚙️ Configure] [↑ ↓]       │
│  └─────────────────┘                                        │
│         ↓                                                   │
│  ┌─────────────────┐                                        │
│  │ 🎯 AI Routing   │ [✓ Enabled] [⚙️ 3-Tier Settings]       │
│  └─────────────────┘                                        │
│         ↓                                                   │
│  ┌─────────────────┐                                        │
│  │ 🛡️ Guardrails   │ [✓ Enabled] [⚙️ Configure] [↑ ↓]       │
│  └─────────────────┘                                        │
│         ↓                                                   │
│  [📢 Response]                                              │
│                                                             │
│  [+ Add Custom Step]  [💾 Save Flow]  [📊 Test Flow]        │
└─────────────────────────────────────────────────────────────┘
```

**Features:**
- ✅ Drag-and-drop to reorder steps
- ✅ Enable/disable any step
- ✅ Click to configure each block
- ✅ Visual preview of call flow
- ✅ Test mode (dry-run with sample inputs)
- ✅ Per-company customization
- ✅ Version history & rollback

**Implementation:**
- Could use React Flow or D3.js
- Save as JSON in `company.aiAgentSettings.callFlowConfig`
- Runtime interprets the config dynamically

---

## 📊 **SUMMARY**

**Current State:** ✅ **FULLY WIRED AND OPERATIONAL**

- ✅ Company Instructions → System Prompt (just completed)
- ✅ Behavior Rules → System Prompt (just completed)
- ✅ Edge Cases → Short-circuit (working)
- ✅ Transfer Rules → Routing (working)
- ✅ Guardrails → Content filtering (working)
- ✅ 3-Tier Intelligence → Cost optimization (working)

**Next Steps:**
1. ✅ Test the new system prompt in production
2. 🤔 Consider building the dynamic flowchart UI
3. 📊 Monitor call logs for "warm-up" effectiveness

---

**Questions? Modifications Needed?**

This document is your SOURCE OF TRUTH for understanding and modifying the call flow. Keep it updated as the system evolves!

