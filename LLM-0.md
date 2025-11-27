# 🏗️ LLM-0 ORCHESTRATION ARCHITECTURE

**Enterprise AI Call System - Complete Technical Breakdown**

**Version:** 1.0  
**Last Updated:** November 27, 2025  
**Status:** Production

---

## 📋 TABLE OF CONTENTS

1. [Executive Summary](#executive-summary)
2. [The Problem LLM-0 Solves](#the-problem)
3. [Architecture Overview](#architecture-overview)
4. [Component Wiring Diagram](#component-wiring)
5. [Request Flow (Step-by-Step)](#request-flow)
6. [Code Locations](#code-locations)
7. [Data Flow & State Management](#data-flow)
8. [Decision Tree Logic](#decision-tree)
9. [Production Guarantees](#guarantees)
10. [Debugging & Observability](#debugging)

---

## <a id="executive-summary"></a>1. EXECUTIVE SUMMARY

**LLM-0 is NOT a language model. It's an orchestration framework.**

### What It Does:
- **Receives** user input from Twilio call
- **Routes** through decision layers (Spam → Triage → Intelligence → Policy)
- **Enforces** business rules BEFORE content generation
- **Decides** action (CONTINUE / TRANSFER / HANGUP / ESCALATE)
- **Delegates** to GPT-4 ONLY for final response text generation

### Why It Exists:
Without LLM-0, GPT-4 would:
- ❌ Make up services you don't offer
- ❌ Quote incorrect prices
- ❌ Continue abusive conversations
- ❌ Accept credit cards over voice (PCI violation)
- ❌ Answer legal threats without escalation

**LLM-0 is the "executive function" that keeps GPT-4 on-rails.**

---

## <a id="the-problem"></a>2. THE PROBLEM LLM-0 SOLVES

### Before LLM-0 (Naive Approach):

```
User: "I need my heating fixed"
    ↓
GPT-4: [Generates response directly]
    ↓
Response: "Sure! Our technician can come tomorrow. 
           We also do plumbing, electrical, and roofing!" 
           ← HALLUCINATION (you don't do roofing)
```

### The Issue:
- GPT-4 is trained to be "helpful" and will fill in gaps
- No separation between routing logic and content generation
- Business rules must be "remembered" by the model (unreliable)
- Edge cases (abuse, legal, PCI) are just "prompt instructions" (easy to bypass)

---

### After LLM-0 (Orchestrated Approach):

```
User: "I need my heating fixed"
    ↓
[LLM-0 Orchestrator]
    ├─ Spam Filter: ✅ PASS (not spam)
    ├─ Triage: Detects "HVAC_SERVICE_REQUEST"
    ├─ 3-Tier Router: Matches "Heating Repair" scenario
    ├─ CheatSheet: No edge cases fired, continue
    ├─ Decision: CONTINUE with matched scenario
    ↓
GPT-4: [Generates response using ONLY approved scenario]
    ↓
Response: "I can help with your heating repair. 
           Let me get some details..."
```

### The Fix:
- ✅ Routing happens FIRST (deterministic)
- ✅ Business rules enforced at architecture level
- ✅ GPT-4 only generates text for pre-approved paths
- ✅ Edge cases are code-enforced, not prompt-dependent

---

## <a id="architecture-overview"></a>3. ARCHITECTURE OVERVIEW

### The 5-Layer Stack:

```
┌─────────────────────────────────────────────────────────────────┐
│                     TWILIO WEBHOOK LAYER                         │
│  Entry: /api/twilio/voice, /v2-agent-respond                   │
│  Role: HTTP ingress, TwiML generation, session management       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                  LAYER 0: SPAM FIREWALL                         │
│  Component: SmartCallFilter                                     │
│  Decision: BLOCK or ALLOW (+ spam score)                        │
│  Short-circuit: YES (blocked calls never reach LLM-0)           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│              LAYER 1: LLM-0 ORCHESTRATOR CORE                   │
│  Component: v2AIAgentRuntime.processUserInput()                 │
│  Role: Initialize context, load policies, execute call flow     │
│  Output: context object (company, callState, scenarios, etc.)   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│         LAYER 2: DYNAMIC CALL FLOW EXECUTOR                     │
│  Component: CallFlowExecutor.execute()                          │
│  Role: Run steps in configured order (not hardcoded)            │
│  Steps: [frontline, intelligentRouter, cheatsheet, respond]     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│       LAYER 3: INTELLIGENCE & ROUTING (3 SUB-LAYERS)            │
│                                                                  │
│  3A. FRONTLINE-INTEL (Triage)                                   │
│      Component: FrontlineIntel.detectIntent()                   │
│      Role: Initial intent detection, emergency routing           │
│      Output: DIRECT_TO_3TIER / ESCALATE_TO_HUMAN / etc.        │
│                                                                  │
│  3B. INTELLIGENT ROUTER (3-Tier Matching)                       │
│      Component: IntelligentRouter.route()                       │
│      Tiers: Rule/Keyword → Semantic Vector → LLM Fallback      │
│      Output: Matched scenario + confidence score                │
│                                                                  │
│  3C. CHEATSHEET ENGINE (Policy Enforcement)                     │
│      Component: CheatSheetEngine.apply()                        │
│      Precedence: Edge Cases > Transfers > Behavior > Guardrails │
│      Output: Modified response OR action override               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│          LAYER 4: CONTENT GENERATION (GPT-4)                    │
│  Component: ResponseGenerator.generate()                        │
│  Role: Generate actual text AFTER routing is decided            │
│  Input: Scenario + context (never raw user input)               │
│  Output: Natural language response text                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│               LAYER 5: TWIML MAPPER                             │
│  Component: TwiMLResponseBuilder                                │
│  Role: Convert action → <Say>/<Transfer>/<Hangup>               │
│  Output: TwiML XML sent back to Twilio                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## <a id="component-wiring"></a>4. COMPONENT WIRING DIAGRAM

### File-Level Architecture:

```
routes/v2twilio.js
│
├─ POST /api/twilio/voice/:companyID
│  │
│  ├─ SmartCallFilter.checkCall()                    [LAYER 0]
│  │  └─ IF BLOCK → return <Hangup>
│  │
│  ├─ Generate greeting (ElevenLabs or Twilio <Say>) [PRE-LLM-0]
│  │
│  └─ <Gather> with action="/v2-agent-respond/:companyID"
│
└─ POST /api/twilio/v2-agent-respond/:companyID
   │
   ├─ Extract user input (SpeechResult)              [HTTP LAYER]
   │
   ├─ v2AIAgentRuntime.processUserInput()            [LAYER 1 ENTRY]
   │  │
   │  ├─ Load company config from DB
   │  ├─ Load CheatSheet live version (Redis cached)
   │  ├─ Build context object:
   │  │  {
   │  │    companyId,
   │  │    callState,
   │  │    scenarios,
   │  │    contacts,
   │  │    spamContext,           ← from SmartCallFilter
   │  │    ...
   │  │  }
   │  │
   │  └─ CallFlowExecutor.execute(context, steps)    [LAYER 2]
   │     │
   │     ├─ STEP 1: frontline                        [LAYER 3A]
   │     │  └─ FrontlineIntel.detectIntent()
   │     │     └─ Returns: DIRECT_TO_3TIER / ESCALATE / etc.
   │     │
   │     ├─ STEP 2: intelligentRouter                [LAYER 3B]
   │     │  └─ IntelligentRouter.route()
   │     │     ├─ Tier 1: Keyword/Rule matching
   │     │     ├─ Tier 2: Semantic vector search
   │     │     └─ Tier 3: LLM fallback
   │     │     └─ Returns: { scenario, confidence }
   │     │
   │     ├─ STEP 3: cheatsheet                       [LAYER 3C]
   │     │  └─ CheatSheetEngine.apply()
   │     │     ├─ Check Edge Cases (P1: highest)
   │     │     │  ├─ Match: keyword + spamScore + time window
   │     │     │  └─ Action: override / transfer / hangup / flag
   │     │     ├─ Apply Transfer Rules
   │     │     ├─ Apply Behavior Rules
   │     │     └─ Apply Guardrails
   │     │     └─ Returns: Modified response OR action override
   │     │
   │     └─ STEP 4: respond                          [LAYER 4]
   │        └─ ResponseGenerator.generate()
   │           └─ GPT-4 prompt with:
   │              - Matched scenario
   │              - Company context
   │              - Conversation history
   │              - Business rules
   │           └─ Returns: Natural language text
   │
   └─ TwiMLResponseBuilder.build()                   [LAYER 5]
      ├─ action: "CONTINUE" → <Say> + <Gather>
      ├─ action: "TRANSFER" → <Say> + <Dial>
      └─ action: "HANGUP" → <Say> + <Hangup>
```

---

## <a id="request-flow"></a>5. REQUEST FLOW (STEP-BY-STEP)

### Scenario: Normal AC Repair Call

```javascript
// ════════════════════════════════════════════════════════════════
// STEP 0: CALL ARRIVES AT TWILIO
// ════════════════════════════════════════════════════════════════
POST /api/twilio/voice/:companyID
Body: { From: "+1234567890", To: "+1987654321" }

// ────────────────────────────────────────────────────────────────
// LAYER 0: SPAM FIREWALL
// ────────────────────────────────────────────────────────────────
const filterResult = await SmartCallFilter.checkCall({
  fromNumber: "+1234567890",
  toNumber: "+1987654321",
  companyId: "67..."
});

// filterResult = {
//   shouldBlock: false,
//   spamScore: 0.15,
//   reason: null,
//   flags: []
// }

LOG: [SPAM-FIREWALL] decision: ALLOW, spamScore: 0.15

// Attach spam context to session
req.session.spamContext = {
  spamScore: 0.15,
  spamReason: null,
  spamFlags: []
};

// ────────────────────────────────────────────────────────────────
// GREETING + GATHER
// ────────────────────────────────────────────────────────────────
const greeting = await generateGreeting(company); // ElevenLabs TTS
twiml.play(greeting.audioUrl);
twiml.gather({
  input: 'speech',
  action: `/api/twilio/v2-agent-respond/${companyId}`,
  partialResultCallback: `/api/twilio/v2-agent-partial/${companyId}`
});

LOG: [GREETING] initialized
LOG: [GATHER] first-turn configured

return twiml.toString();

// ════════════════════════════════════════════════════════════════
// USER SPEAKS: "Hi, my AC isn't working"
// ════════════════════════════════════════════════════════════════
POST /api/twilio/v2-agent-respond/:companyID
Body: { 
  SpeechResult: "Hi, my AC isn't working",
  Confidence: 0.95,
  CallSid: "CA..."
}

LOG: [AGENT-INPUT] speechResult: "Hi, my AC isn't working"

// ────────────────────────────────────────────────────────────────
// LAYER 1: LLM-0 ORCHESTRATOR ENTRY
// ────────────────────────────────────────────────────────────────
const result = await v2AIAgentRuntime.processUserInput({
  userInput: "Hi, my AC isn't working",
  callState: req.session.callState,
  companyId: "67...",
  context: {
    spamContext: req.session.spamContext
  }
});

// Inside processUserInput():
//   1. Load company from DB
//   2. Load CheatSheet live version (Redis → Mongo)
//   3. Load scenarios (3-Tier knowledge)
//   4. Build full context object
//   5. Call CallFlowExecutor.execute()

// ────────────────────────────────────────────────────────────────
// LAYER 2: CALL FLOW EXECUTOR
// ────────────────────────────────────────────────────────────────
const context = {
  userInput: "Hi, my AC isn't working",
  companyId: "67...",
  callState: { ... },
  scenarios: [ ... ],      // From DB
  contacts: [ ... ],       // From company config
  spamContext: { ... },    // From session
  cheatSheetConfig: { ... } // Live version from Redis
};

const steps = ['frontline', 'intelligentRouter', 'cheatsheet', 'respond'];

await CallFlowExecutor.execute(context, steps);

// ────────────────────────────────────────────────────────────────
// LAYER 3A: FRONTLINE-INTEL (Triage)
// ────────────────────────────────────────────────────────────────
const triageResult = await FrontlineIntel.detectIntent(
  "Hi, my AC isn't working",
  context
);

// triageResult = {
//   intent: "SERVICE_REQUEST",
//   action: "DIRECT_TO_3TIER",
//   confidence: 0.9,
//   reason: "normal_service_inquiry"
// }

LOG: [FRONTLINE] triageResult: DIRECT_TO_3TIER

context.triageResult = triageResult;

// ────────────────────────────────────────────────────────────────
// LAYER 3B: INTELLIGENT ROUTER (3-Tier)
// ────────────────────────────────────────────────────────────────
const routingResult = await IntelligentRouter.route(
  "Hi, my AC isn't working",
  context.scenarios,
  context
);

// TIER 1: Keyword matching
// - Check "AC", "air conditioning", "cooling" keywords
// - MATCH FOUND: Scenario "AC Not Working" (category: HVAC)

// routingResult = {
//   scenario: {
//     scenarioId: "scenario-12345",
//     name: "AC Not Working",
//     category: "HVAC",
//     quickReplies: ["I can help with that..."],
//     fullReplies: ["I'd be happy to help..."],
//     followUpFunnel: "Would you like to schedule?"
//   },
//   tier: "TIER_1",
//   confidence: 0.95
// }

LOG: [3TIER] tierUsed: TIER_1, scenarioId: scenario-12345, confidence: 0.95

context.matchedScenario = routingResult.scenario;
context.baseResponse = routingResult.scenario.fullReplies[0];

// ────────────────────────────────────────────────────────────────
// LAYER 3C: CHEATSHEET ENGINE (Policy Enforcement)
// ────────────────────────────────────────────────────────────────
const policyResult = await CheatSheetEngine.apply(
  context.baseResponse,
  "Hi, my AC isn't working",
  context
);

// PRECEDENCE CHECK:
// 1. Edge Cases: Check all enabled edge cases (priority sorted)
//    - "High-Risk Spam": minSpamScore: 0.85 → SKIP (spamScore: 0.15)
//    - "Abuse Detection": keywords: ["idiot", "sue"] → NO MATCH
//    - No edge case fired
//
// 2. Transfer Rules: Check transfer conditions
//    - No transfer keywords detected
//
// 3. Behavior Rules: Apply tone/length/politeness
//    - No modifications needed
//
// 4. Guardrails: Final safety check
//    - No PCI data detected
//    - No out-of-scope topics

// policyResult = {
//   response: "I'd be happy to help with your AC...",
//   action: "CONTINUE",
//   appliedBlocks: [],
//   shortCircuit: false
// }

LOG: [CHEATSHEET] appliedBlocks: [], finalAction: CONTINUE

context.finalResponse = policyResult.response;
context.finalAction = policyResult.action;

// ────────────────────────────────────────────────────────────────
// LAYER 4: CONTENT GENERATION (GPT-4)
// ────────────────────────────────────────────────────────────────
// NOTE: In this case, we already have fullReplies from scenario,
// so GPT-4 might not be called. But if needed:

const generatedResponse = await ResponseGenerator.generate({
  scenario: context.matchedScenario,
  userInput: "Hi, my AC isn't working",
  companyContext: context.company,
  conversationHistory: context.callState.history,
  constraints: {
    maxLength: 200,
    tone: "friendly-professional",
    includeFollowUp: true
  }
});

// GPT-4 Prompt (simplified):
// """
// You are an AI receptionist for Penguin Air Conditioning.
// 
// Scenario: AC Not Working
// User said: "Hi, my AC isn't working"
// 
// Generate a helpful response. DO NOT:
// - Offer services we don't provide
// - Quote prices (transfer to office)
// - Accept payment info (PCI violation)
// 
// Keep it under 200 characters and offer to schedule.
// """

// generatedResponse = {
//   text: "I can help with your AC repair. Can you tell me what's happening?"
// }

context.finalResponse = generatedResponse.text;

LOG: [AGENT-OUTPUT] finalAction: CONTINUE, willTransfer: false

// ────────────────────────────────────────────────────────────────
// LAYER 5: TWIML MAPPER
// ────────────────────────────────────────────────────────────────
const twiml = TwiMLResponseBuilder.build({
  action: context.finalAction,
  response: context.finalResponse,
  shouldGather: true
});

// twiml =
// <Response>
//   <Say>I can help with your AC repair. Can you tell me what's happening?</Say>
//   <Gather input="speech" action="/v2-agent-respond/67...">
//   </Gather>
// </Response>

return twiml.toString();

// ════════════════════════════════════════════════════════════════
// TWILIO PLAYS RESPONSE TO CALLER
// ════════════════════════════════════════════════════════════════
// Caller hears: "I can help with your AC repair..."
// Twilio waits for next input → repeat cycle
```

---

## <a id="code-locations"></a>6. CODE LOCATIONS

### Core Files:

| Component | File Path | Key Method |
|-----------|-----------|------------|
| **Twilio Entry** | `routes/v2twilio.js` | `POST /v2-agent-respond/:companyID` |
| **Spam Filter** | `services/SmartCallFilter.js` | `checkCall()` |
| **LLM-0 Core** | `services/v2AIAgentRuntime.js` | `processUserInput()` |
| **Call Flow Executor** | `services/CallFlowExecutor.js` | `execute()` |
| **Frontline-Intel** | `services/FrontlineIntel.js` | `detectIntent()` |
| **3-Tier Router** | `services/IntelligentRouter.js` | `route()` |
| **CheatSheet Engine** | `services/CheatSheetEngine.js` | `apply()`, `detectEdgeCase()` |
| **CheatSheet Runtime** | `services/cheatsheet/CheatSheetRuntimeService.js` | `getRuntimeConfig()` |
| **Response Generator** | `services/ResponseGenerator.js` | `generate()` |
| **TwiML Builder** | `services/TwiMLResponseBuilder.js` | `build()` |

### Configuration Sources:

| Data | Storage | Cache | Loaded By |
|------|---------|-------|-----------|
| **Company Settings** | MongoDB `v2Company` | No | `v2AIAgentRuntime` |
| **CheatSheet Live Config** | MongoDB `CheatSheetVersion` | Redis (live:{companyId}) | `CheatSheetRuntimeService` |
| **Scenarios (3-Tier)** | MongoDB `Scenario` | No | `v2AIAgentRuntime` |
| **Company Contacts** | MongoDB `v2Company.contacts` | No | `v2AIAgentRuntime` |
| **Spam Data** | MongoDB `GlobalSpamDatabase` | No | `SmartCallFilter` |
| **Compiled Policies** | MongoDB `CheatSheetVersion` | Redis (policy:{companyId}:active) | `CheatSheetRuntimeService` |

---

## <a id="data-flow"></a>7. DATA FLOW & STATE MANAGEMENT

### Context Object Structure:

```javascript
// Full context passed through all layers
const context = {
  // ═══════════════════════════════════════════════════════════
  // INPUT DATA
  // ═══════════════════════════════════════════════════════════
  userInput: "Hi, my AC isn't working",
  callSid: "CA1234567890",
  fromNumber: "+1234567890",
  toNumber: "+1987654321",
  
  // ═══════════════════════════════════════════════════════════
  // COMPANY & CONFIG
  // ═══════════════════════════════════════════════════════════
  companyId: "67e3f77a9d623b8058c700c4",
  company: {
    name: "Penguin Air Conditioning",
    businessHours: { ... },
    contacts: [ ... ],
    aiAgentSettings: { ... }
  },
  
  // ═══════════════════════════════════════════════════════════
  // CALL STATE (Session Persistence)
  // ═══════════════════════════════════════════════════════════
  callState: {
    callId: "CA...",
    from: "+1234567890",
    consecutiveSilences: 0,
    failedAttempts: 0,
    startTime: Date,
    history: [
      { role: "user", content: "Hi, my AC isn't working" },
      { role: "assistant", content: "I can help with that..." }
    ],
    spamContext: {
      spamScore: 0.15,
      spamReason: null,
      spamFlags: []
    }
  },
  
  // ═══════════════════════════════════════════════════════════
  // KNOWLEDGE BASE (3-Tier Router)
  // ═══════════════════════════════════════════════════════════
  scenarios: [
    {
      scenarioId: "scenario-12345",
      name: "AC Not Working",
      category: "HVAC",
      triggers: ["AC", "air conditioning", "cooling"],
      quickReplies: [ ... ],
      fullReplies: [ ... ]
    },
    // ... 20+ more scenarios
  ],
  
  // ═══════════════════════════════════════════════════════════
  // LIVE CHEATSHEET CONFIG (Policy Layer)
  // ═══════════════════════════════════════════════════════════
  cheatSheetConfig: {
    edgeCases: [
      {
        id: "ec-high-risk-spam",
        name: "High-Risk Caller – Auto Hangup",
        enabled: true,
        priority: 1,
        match: {
          keywordsAny: [],
          minSpamScore: 0.85,
          spamRequired: true
        },
        action: {
          type: "polite_hangup",
          hangupMessage: "Sorry, we're unable to take this call..."
        }
      },
      // ... more edge cases
    ],
    transferRules: { ... },
    behavior: { ... },
    guardrails: { ... }
  },
  
  // ═══════════════════════════════════════════════════════════
  // ROUTING RESULTS (Populated During Execution)
  // ═══════════════════════════════════════════════════════════
  triageResult: {
    intent: "SERVICE_REQUEST",
    action: "DIRECT_TO_3TIER",
    confidence: 0.9
  },
  
  matchedScenario: {
    scenarioId: "scenario-12345",
    name: "AC Not Working",
    // ... full scenario object
  },
  
  baseResponse: "I'd be happy to help with your AC repair...",
  
  // ═══════════════════════════════════════════════════════════
  // FINAL OUTPUT (After Policy Enforcement)
  // ═══════════════════════════════════════════════════════════
  finalResponse: "I can help with your AC repair. Can you tell me...",
  finalAction: "CONTINUE",  // or "TRANSFER", "HANGUP", "ESCALATE"
  appliedBlocks: [],        // Edge cases / rules that fired
  transferTarget: null,     // If transferring, who to
  hangupReason: null        // If hanging up, why
};
```

---

## <a id="decision-tree"></a>8. DECISION TREE LOGIC

### LLM-0 Decision Flow:

```
User Input Received
    ↓
┌───────────────────────────────────────────┐
│ LAYER 3A: FRONTLINE-INTEL (Triage)       │
├───────────────────────────────────────────┤
│ Detect Intent → Return Action             │
│                                            │
│ Possible Actions:                          │
│ • DIRECT_TO_3TIER     → Continue to router│
│ • ESCALATE_TO_HUMAN   → Transfer now      │
│ • REQUEST_CALLBACK    → Schedule callback  │
│ • OUT_OF_HOURS        → Play message      │
└───────────────────────────────────────────┘
    ↓ [If DIRECT_TO_3TIER]
┌───────────────────────────────────────────┐
│ LAYER 3B: INTELLIGENT ROUTER (3-Tier)    │
├───────────────────────────────────────────┤
│ Match User Input to Scenario              │
│                                            │
│ TIER 1: Rule/Keyword Matching             │
│   ├─ Check keywords in scenario triggers  │
│   └─ If match → confidence: 0.9+          │
│                                            │
│ TIER 2: Semantic Vector Search            │
│   ├─ Embed user input                     │
│   ├─ Cosine similarity to scenarios       │
│   └─ If match → confidence: 0.7-0.9       │
│                                            │
│ TIER 3: LLM Fallback (GPT-4)              │
│   ├─ Ask GPT-4: "Which scenario matches?" │
│   └─ confidence: 0.5-0.7                  │
│                                            │
│ NO MATCH:                                  │
│   └─ Use fallback scenario ("General")    │
└───────────────────────────────────────────┘
    ↓ [Scenario Matched]
┌───────────────────────────────────────────┐
│ LAYER 3C: CHEATSHEET ENGINE (Policy)     │
├───────────────────────────────────────────┤
│ Enforce Business Rules (PRECEDENCE ORDER) │
│                                            │
│ STEP 1: EDGE CASES (HIGHEST PRIORITY)     │
│   ├─ Sort by priority (1 = highest)       │
│   ├─ Check conditions:                     │
│   │   • Keywords match?                    │
│   │   • Spam score >= minSpamScore?       │
│   │   • Time window match?                 │
│   │   • Caller type match?                 │
│   ├─ IF MATCH:                             │
│   │   ├─ override_response → Replace text │
│   │   ├─ force_transfer → Transfer now    │
│   │   ├─ polite_hangup → Hangup now       │
│   │   └─ flag_only → Log + continue       │
│   └─ IF NOT "flag_only" → SHORT-CIRCUIT   │
│       (skip remaining rules)               │
│                                            │
│ STEP 2: TRANSFER RULES                     │
│   ├─ Check transfer keywords               │
│   ├─ IF MATCH → action: "TRANSFER"        │
│   └─ SHORT-CIRCUIT                         │
│                                            │
│ STEP 3: BEHAVIOR RULES                     │
│   ├─ Modify tone, length, politeness      │
│   ├─ Add/remove disclaimers                │
│   └─ Continue                              │
│                                            │
│ STEP 4: GUARDRAILS (Safety Net)           │
│   ├─ Check for PCI data                    │
│   ├─ Check for out-of-scope topics        │
│   └─ Override if violated                  │
└───────────────────────────────────────────┘
    ↓ [Policy Applied]
┌───────────────────────────────────────────┐
│ FINAL ACTION DECISION                     │
├───────────────────────────────────────────┤
│ IF action == "CONTINUE":                   │
│   └─ Generate response text (GPT-4)       │
│       └─ Return <Say> + <Gather>          │
│                                            │
│ IF action == "TRANSFER":                   │
│   └─ Generate transfer message (optional) │
│       └─ Return <Say> + <Dial>            │
│                                            │
│ IF action == "HANGUP":                     │
│   └─ Play hangup message                  │
│       └─ Return <Say> + <Hangup>          │
│                                            │
│ IF action == "ESCALATE":                   │
│   └─ Transfer to owner/manager            │
│       └─ Return <Say> + <Dial>            │
└───────────────────────────────────────────┘
```

---

## <a id="guarantees"></a>9. PRODUCTION GUARANTEES

### What LLM-0 Guarantees:

| Guarantee | How It's Enforced | Failure Mode |
|-----------|-------------------|--------------|
| **No Hallucinations** | GPT-4 only generates text for matched scenarios | Fallback to generic scenario if no match |
| **Policy Enforcement** | Edge cases are code-checked, not prompt-dependent | Short-circuit on edge case match |
| **Spam Protection** | SmartCallFilter blocks before LLM-0 even runs | High-spam calls never reach intelligence |
| **PCI Compliance** | CheatSheet guardrails detect credit card patterns | Override response with "no card over phone" |
| **Legal Safety** | Edge case for "lawsuit", "sue" → force transfer | Manager handles, not AI |
| **Abuse Handling** | Edge case for profanity → polite hangup | Auto-blacklist + log |
| **Deterministic Routing** | 3-Tier always returns a scenario | Fallback scenario if all tiers fail |

### Short-Circuit Logic:

```javascript
// Edge Cases SHORT-CIRCUIT the entire flow
if (edgeCase.action.type === 'polite_hangup') {
  return {
    response: edgeCase.action.hangupMessage,
    action: 'HANGUP',
    appliedBlocks: [{ type: 'edge_case', id: edgeCase.id }],
    shortCircuit: true  // ← STOPS HERE, no 3-Tier, no GPT-4
  };
}
```

**Why This Matters:**
- Abusive caller → hangup IMMEDIATELY (no chance for AI to respond)
- High spam score → hangup BEFORE intelligence runs
- Legal threat → transfer to manager (no AI involvement)

---

## <a id="debugging"></a>10. DEBUGGING & OBSERVABILITY

### Structured Logging (Production):

Every layer emits structured JSON logs for traceability:

```javascript
// LAYER 0: Spam Filter
logger.info('[SPAM-FIREWALL] decision', {
  route: '/voice',
  companyId: '67...',
  fromNumber: '+1234567890',
  decision: 'ALLOW',
  spamScore: 0.15,
  spamFlags: [],
  callSid: 'CA...',
  timestamp: '2025-11-27T...'
});

// LAYER 1: LLM-0 Entry
logger.info('[AGENT-INPUT]', {
  companyId: '67...',
  callSid: 'CA...',
  speechResult: "Hi, my AC isn't working",
  confidence: 0.95
});

// LAYER 3A: Frontline
logger.info('[FRONTLINE]', {
  companyId: '67...',
  callSid: 'CA...',
  triageResult: 'DIRECT_TO_3TIER',
  reason: 'normal_service_inquiry',
  confidence: 0.9
});

// LAYER 3B: 3-Tier Router
logger.info('[3TIER]', {
  companyId: '67...',
  callSid: 'CA...',
  tierUsed: 'TIER_1',
  scenarioId: 'scenario-12345',
  scenarioName: 'AC Not Working',
  confidence: 0.95
});

// LAYER 3C: CheatSheet Engine
logger.info('[CHEATSHEET]', {
  companyId: '67...',
  callSid: 'CA...',
  appliedBlocks: [
    {
      type: 'edge_case',
      id: 'ec-abuse-detection',
      name: 'Abuse & Profanity Detection',
      actionType: 'polite_hangup',
      priority: 2,
      matchedPattern: 'idiot|sue',
      spamScore: 0.15,
      spamBridgeActive: false
    }
  ],
  finalAction: 'HANGUP',
  shortCircuit: true,
  timeMs: 12
});

// LAYER 4: Final Output
logger.info('[AGENT-OUTPUT]', {
  companyId: '67...',
  callSid: 'CA...',
  finalAction: 'HANGUP',
  shortResponsePreview: 'Thank you for calling...',
  willTransfer: false,
  willHangup: true
});
```

### Key Debug Points:

| Log Tag | What to Check | Red Flag |
|---------|---------------|----------|
| `[SPAM-FIREWALL]` | Is spam score accurate? | `spamScore > 0.7` but `decision: ALLOW` |
| `[AGENT-INPUT]` | Is user input captured correctly? | `confidence < 0.7` (bad transcription) |
| `[FRONTLINE]` | Is triage routing correctly? | All calls route to `ESCALATE_TO_HUMAN` |
| `[3TIER]` | Is scenario matching working? | Always uses `TIER_3` (fallback) |
| `[CHEATSHEET]` | Are edge cases firing? | `appliedBlocks: []` when abuse detected |
| `[AGENT-OUTPUT]` | Is final action correct? | `willHangup: false` when edge case fired |

### Active Instructions Preview (X-Ray Vision):

```
Control Plane → CheatSheet → Active Instructions Preview

Shows EXACTLY what the live agent is using:
- Edge Cases (count, priority, action types)
- Transfer Rules
- Behavior Rules
- Guardrails
- Frontline-Intel config
- Booking Rules
- Company Contacts

Toggle: Readable View | Raw JSON
```

**This is your "config snapshot" — if Active Instructions shows it, the agent is using it.**

---

## 🎯 SUMMARY FOR ENGINEERS

### LLM-0 is NOT an LLM. It's a Framework.

**Core Principle:**
> "Route first, generate last. Enforce policies at the architecture level, not the prompt level."

**5 Layers:**
1. **Spam Filter** → Block bad actors
2. **LLM-0 Core** → Load config, build context
3. **Intelligence** → Triage → Route → Policy
4. **GPT-4** → Generate text (within constraints)
5. **TwiML** → Convert to Twilio commands

**Guarantees:**
- ✅ No hallucinations (scenario-driven)
- ✅ Policy enforcement (code-checked)
- ✅ Short-circuit logic (edge cases override)
- ✅ Observable (structured logs)
- ✅ Cacheable (Redis for live config)

**Production-Ready Checklist:**
- [ ] All logs present (`[SPAM-FIREWALL]` through `[AGENT-OUTPUT]`)
- [ ] Edge cases fire when expected
- [ ] Active Instructions Preview shows live config
- [ ] Real call tests pass (normal, abusive, high-spam)
- [ ] No bypassing policies (short-circuit works)

---

## 📚 RELATED DOCUMENTATION

- [CALL-FLOW-MAP-COMPLETE.md](./CALL-FLOW-MAP-COMPLETE.md) - 10-step visual flow
- [ARCHITECTURE-DEFENSE-LLM0-ORCHESTRATION.md](./ARCHITECTURE-DEFENSE-LLM0-ORCHESTRATION.md) - Defense strategy
- [AUDIT-AGENT-BRAIN-2025-11-27.md](./AUDIT-AGENT-BRAIN-2025-11-27.md) - Agent Brain audit
- [EDGE-CASES-ENTERPRISE-COMPLETE-2025-11-27.md](./EDGE-CASES-ENTERPRISE-COMPLETE-2025-11-27.md) - Edge Case system
- [docs/LIVE-CALL-TEST-MATRIX.md](./docs/LIVE-CALL-TEST-MATRIX.md) - Production testing guide

---

**Created:** November 27, 2025  
**Author:** AI Coder (with Marc's vision)  
**Purpose:** Technical documentation for engineers joining the project  
**Status:** Production

